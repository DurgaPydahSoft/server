// ─── FEATURE FLAG ────────────────────────────────────────────────────────────
// Set to true  → electricity bills sync demands into the external Fees DB
// Set to false → bills save normally but NO StudentFee records are created
const ELECTRICITY_FEE_SYNC_ENABLED = false;
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from 'mongoose';
import HostelRequest from '../models/HostelRequest.js';
import StudentMaster from '../models/StudentMaster.js';
import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import ElectricitySettings from '../models/ElectricitySettings.js';
import ElectricityBill from '../models/ElectricityBill.js';
import GeneratorBill from '../models/GeneratorBill.js';
import Room from '../models/Room.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import NOC from '../models/NOC.js';
import {
  connectFeesDatabase,
  getFeesConnection,
  isFeesDbConfigured
} from '../config/feesDatabase.js';
import { getStudentFeeModel } from '../models/fees/StudentFee.js';
import {
  buildStudentFeePayload,
  resolveFeesStudentId,
  toFeesAcademicYear
} from './feesSyncService.js';
import { enrichStudentAcademics } from '../utils/studentAcademicEnricher.js';
import { getISTStartOfDay, getISTEndOfDay } from '../utils/dateUtils.js';

const FEE_HEADS_COLLECTION = 'feeheads';

/** Legacy threshold — no longer used for eligibility (shares use attendance days directly). */
export const MIN_ATTENDANCE_DAYS_FOR_ELECTRICITY_DEMAND = 0;

/** Academic year starts in June (matches past-payments / backfill convention). */
export const getAcademicYearForMonth = (monthStr) => {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return null;
  const [yearStr, monthPart] = monthStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthPart);
  if (!year || !month) return null;
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
};

export const getMonthBounds = (monthStr) => {
  const [yearStr, monthPart] = monthStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthPart);
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
};

const asDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Hostel request overlapped the bill month while allocated to this room.
 * Uses active + expired (left mid-year); excludes cancelled before the month.
 */
export const requestOverlapsBillMonth = (request, monthStart, monthEnd) => {
  if (!request) return false;

  if (request.status === 'cancelled') {
    const cancelledAt = asDate(request.cancelledAt);
    if (cancelledAt && cancelledAt < monthStart) return false;
  }

  const joined =
    asDate(request.joiningDate) ||
    asDate(request.admitDate) ||
    asDate(request.allocatedAt) ||
    asDate(request.createdAt);
  if (joined && joined > monthEnd) return false;

  const left =
    asDate(request.segmentEndExclusive) ||
    asDate(request.leftDate) ||
    asDate(request.expiredAt);
  // segmentEndExclusive is exclusive: still overlaps if left === monthStart boundary handled by $gt in query;
  // for filter: if exclusive end <= monthStart, no overlap
  if (request.segmentEndExclusive != null) {
    const endEx = asDate(request.segmentEndExclusive);
    if (endEx && endEx <= monthStart) return false;
  } else if (left && left < monthStart) {
    return false;
  }

  return true;
};

/**
 * Occupants for a room+month from RoomOccupancyHistory segments (includes Transferred).
 * allocatedTo is exclusive end so mid-month transfers split correctly across rooms.
 */
export const getHistoryOccupantsForRoomMonth = async (room, monthStr) => {
  if (!room?._id || !monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return [];

  const year = parseInt(monthStr.slice(0, 4));
  const month = parseInt(monthStr.slice(5, 7)) - 1;
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

  const segments = await RoomOccupancyHistory.find({
    room: room._id,
    allocatedFrom: { $lte: monthEnd },
    $or: [{ allocatedTo: null }, { allocatedTo: { $gt: monthStart } }]
  })
    .sort({ allocatedFrom: 1 })
    .lean();

  if (!segments.length) {
    return getLiveActiveOccupantsForRoom(room);
  }

  const requestIds = [
    ...new Set(segments.map((s) => String(s.hostelRequestId || '')).filter(Boolean))
  ];
  const requests = requestIds.length
    ? await HostelRequest.find({ _id: { $in: requestIds } })
        .populate('studentMasterId', 'admissionNumber name rollNumber studentPhone userId')
        .lean()
    : [];
  const requestById = new Map(requests.map((r) => [String(r._id), r]));

  // Get all unique student user IDs to look up approved NOCs
  const studentUserIds = [
    ...new Set([
      ...segments.map((s) => String(s.student || '')).filter(Boolean),
      ...requests.map((r) => String(r.studentMasterId?.userId || '')).filter(Boolean)
    ])
  ];

  const nocs = studentUserIds.length
    ? await NOC.find({ student: { $in: studentUserIds }, status: 'Approved' }).lean()
    : [];
  const nocByStudentId = new Map(nocs.map((n) => [String(n.student), n]));

  return segments.map((seg) => {
    const req = seg.hostelRequestId ? requestById.get(String(seg.hostelRequestId)) : null;
    const allocatedFrom = asDate(seg.allocatedFrom);
    const allocatedTo = asDate(seg.allocatedTo);

    const studentIdStr = String(seg.student || req?.studentMasterId?.userId || '');
    const studentNoc = studentIdStr ? nocByStudentId.get(studentIdStr) : null;
    const nocVacatingDate = studentNoc ? asDate(studentNoc.vacatingDate) : null;
    const requestLeftDate = req ? (asDate(req.leftDate) || asDate(req.expiredAt)) : null;

    const resolvedLeftDate = nocVacatingDate || requestLeftDate;

    let segmentEnd = allocatedTo;
    if (resolvedLeftDate) {
      const exclusiveLeftEnd = new Date(resolvedLeftDate.getTime() + 24 * 60 * 60 * 1000);
      if (!segmentEnd || exclusiveLeftEnd < segmentEnd) {
        segmentEnd = exclusiveLeftEnd;
      }
    }

    return {
      ...(req || {}),
      _id: req?._id || seg.hostelRequestId || seg._id,
      admissionNumber: req?.admissionNumber || seg.rollNumber || '',
      sdmsName: req?.sdmsName || seg.studentName || '',
      sdmsRollNumber: req?.sdmsRollNumber || seg.rollNumber || '',
      academicYear: req?.academicYear || seg.academicYear,
      status: req?.status || (seg.status === 'Active' ? 'active' : 'expired'),
      roomId: room._id,
      roomNumber: seg.roomNumber || room.roomNumber,
      bedNumber: seg.bedNumber || req?.bedNumber,
      lockerNumber: seg.lockerNumber || req?.lockerNumber,
      hostelId: seg.hostel || req?.hostelId,
      studentMasterId: req?.studentMasterId,
      joiningDate: allocatedFrom,
      admitDate: allocatedFrom,
      allocatedAt: allocatedFrom,
      leftDate: resolvedLeftDate || (allocatedTo ? new Date(allocatedTo.getTime() - 24 * 60 * 60 * 1000) : null),
      expiredAt: null,
      segmentEndExclusive: segmentEnd,
      occupancyHistoryId: seg._id,
      historyStudentId: seg.student
    };
  });
};

/**
 * Live active HostelRequests in a room (any academic year).
 * Prefer getHistoryOccupantsForRoomMonth for electricity billing months.
 */
export const getLiveActiveOccupantsForRoom = async (room) => {
  if (!room?._id) return [];

  return HostelRequest.find({
    roomId: room._id,
    status: { $in: ['active', 'expired'] }
  })
    .populate('studentMasterId', 'admissionNumber name rollNumber studentPhone userId')
    .sort({ allocatedAt: 1, academicYear: -1 })
    .lean();
};

/**
 * Occupants for billing a room month — history segments when available.
 */
export const getActiveOccupantsForRoomMonth = async (room, monthStr) => {
  return getHistoryOccupantsForRoomMonth(room, monthStr);
};

const roundShare = (total, count) => {
  if (!count || count <= 0) return 0;
  return Math.round(Number(total) / count);
};

export const getGeneratorAmountForMonth = async (monthStr, hostelId) => {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr) || !hostelId) return 0;
  const hostel = hostelId?._id || hostelId;
  const generatorBill = await GeneratorBill.findOne({ month: monthStr, hostel }).lean();
  return resolveGeneratorTotal(generatorBill);
};

export const getJoinedDateFromRequest = (req) =>
  asDate(req?.joiningDate) ||
  asDate(req?.admitDate) ||
  asDate(req?.allocatedAt) ||
  asDate(req?.createdAt);

export const isPastJoinerForMonth = (joinedDate, monthStart) =>
  Boolean(joinedDate && monthStart && joinedDate < monthStart);

/**
 * Calendar days billed in the month for a room occupancy segment.
 * allocatedTo is treated as exclusive end (transfer date = first day in new room).
 * Falls back to joining-day → month-end when no segment end is provided.
 */
export const getSegmentBillingDaysInMonth = (
  allocatedFrom,
  allocatedToExclusive,
  monthStart,
  year,
  month
) => {
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
  const from = allocatedFrom instanceof Date ? allocatedFrom : asDate(allocatedFrom);
  if (!from) return 0;

  const nextMonthStart = new Date(year, month + 1, 1);
  const monthEndInclusive = new Date(year, month, totalDaysInMonth);

  const start =
    from < monthStart
      ? monthStart
      : new Date(from.getFullYear(), from.getMonth(), from.getDate());

  let endExclusive = allocatedToExclusive
    ? allocatedToExclusive instanceof Date
      ? allocatedToExclusive
      : asDate(allocatedToExclusive)
    : nextMonthStart;
  if (!endExclusive || endExclusive > nextMonthStart) endExclusive = nextMonthStart;
  endExclusive = new Date(
    endExclusive.getFullYear(),
    endExclusive.getMonth(),
    endExclusive.getDate()
  );

  if (start >= endExclusive) return 0;
  if (start > monthEndInclusive) return 0;

  const lastInclusive = new Date(
    endExclusive.getFullYear(),
    endExclusive.getMonth(),
    endExclusive.getDate() - 1
  );
  if (lastInclusive < monthStart) return 0;

  const startDay =
    start.getFullYear() === year && start.getMonth() === month ? start.getDate() : 1;
  const endDay =
    lastInclusive.getFullYear() === year && lastInclusive.getMonth() === month
      ? lastInclusive.getDate()
      : totalDaysInMonth;

  if (endDay < startDay) return 0;
  return endDay - startDay + 1;
};

/**
 * Calendar days billed in the month for an occupant (no transfer end).
 * Past joiners / unknown join → full month.
 * Mid-month joiners → inclusive days from joining date through month end.
 */
export const getStayBillingDaysInMonth = (joinedDate, monthStart, year, month) =>
  getSegmentBillingDaysInMonth(joinedDate, null, monthStart, year, month);

/**
 * All month-overlapping occupants are eligible.
 * Mid-month share uses joining-day → month-end calendar days (not attendance).
 */
export const isEligibleForElectricityDemand = (
  _attendanceDays,
  _opts = {}
) => true;

/** Hostel generator total: litres × rate when diesel inputs present, else legacy amount. */
export const resolveGeneratorTotal = (generatorBill) => {
  if (!generatorBill) return 0;
  const litres = Number(generatorBill.dieselLitres);
  const rate = Number(generatorBill.perLitreAmount);
  const hasDieselInputs =
    (Number.isFinite(litres) && litres > 0) || (Number.isFinite(rate) && rate > 0);
  if (hasDieselInputs) {
    return Math.round((Number.isFinite(litres) ? litres : 0) * (Number.isFinite(rate) ? rate : 0) * 100) / 100;
  }
  return Number(generatorBill.amount) || 0;
};

/**
 * Split a total among eligible rows (equal vs mixed-joiner).
 * Returns per-row amounts aligned with eligibleRows order + mean share.
 */
export const splitAmountAmongEligibleRows = (
  eligibleRows,
  totalAmount,
  monthStart,
  year,
  month,
  { hasNewJoining: hasNewJoiningOverride = null } = {}
) => {
  const total = Number(totalAmount) || 0;
  if (!eligibleRows.length) {
    return { amounts: [], meanShare: 0, hasNewJoining: false, totalBillingDays: 0 };
  }

  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

  const hasNewJoining =
    hasNewJoiningOverride != null
      ? Boolean(hasNewJoiningOverride)
      : eligibleRows.some((r) => {
          const joined = r.joinedDate instanceof Date ? r.joinedDate : asDate(r.joinedDate);
          const end = r.segmentEndExclusive ?? r.allocatedTo ?? null;
          const days = getSegmentBillingDaysInMonth(joined, end, monthStart, year, month);
          // Day-split if anyone joined mid-month OR transferred out mid-month (partial segment)
          return days > 0 && days < totalDaysInMonth;
        });

  if (hasNewJoining) {
    const totalBillingDays = eligibleRows.reduce((sum, r) => {
      const joined = r.joinedDate instanceof Date ? r.joinedDate : asDate(r.joinedDate);
      const end = r.segmentEndExclusive ?? r.allocatedTo ?? null;
      return sum + getSegmentBillingDaysInMonth(joined, end, monthStart, year, month);
    }, 0);

    const amounts = eligibleRows.map((row) => {
      if (totalBillingDays <= 0) return Math.round(total / eligibleRows.length);
      const joined = row.joinedDate instanceof Date ? row.joinedDate : asDate(row.joinedDate);
      const end = row.segmentEndExclusive ?? row.allocatedTo ?? null;
      const billingDays = getSegmentBillingDaysInMonth(joined, end, monthStart, year, month);
      return Math.round(billingDays * (total / totalBillingDays));
    });

    return {
      amounts,
      meanShare: Math.round(total / eligibleRows.length),
      hasNewJoining: true,
      totalBillingDays
    };
  }

  const equal = roundShare(total, eligibleRows.length);
  return {
    amounts: eligibleRows.map(() => equal),
    meanShare: equal,
    hasNewJoining: false,
    totalBillingDays: eligibleRows.length * totalDaysInMonth
  };
};

const buildElectricityDemandRemarks = ({
  month,
  roomNumber,
  electricityAmount = 0,
  generatorAmount = 0,
  totalAmount = 0,
  roomElectricityTotal = 0
}) => {
  const parts = ['Electricity bill'];
  if (month) parts.push(`Month ${month}`);
  if (roomNumber) parts.push(`Room ${roomNumber}`);
  parts.push(`Electricity Rs.${Number(electricityAmount || 0).toFixed(2)}`);
  if (Number(generatorAmount) > 0) {
    parts.push(`Generator Rs.${Number(generatorAmount || 0).toFixed(2)}`);
  }
  parts.push(`Total Rs.${Number(totalAmount || 0).toFixed(2)}`);
  parts.push(`Room electricity total Rs.${Number(roomElectricityTotal || 0).toFixed(2)}`);
  return parts.join(' | ');
};

/** Days in YYYY-MM with Present or Partial (any session true). */
export const countPresentOrPartialDaysInMonth = async (studentId, monthStr) => {
  if (!studentId || !monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return 0;
  const [y, m] = monthStr.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const start = getISTStartOfDay(`${monthStr}-01`);
  const end = getISTEndOfDay(`${monthStr}-${String(lastDay).padStart(2, '0')}`);
  if (!start || !end) return 0;

  return Attendance.countDocuments({
    student: studentId,
    date: { $gte: start, $lte: end },
    $or: [{ morning: true }, { evening: true }, { night: true }]
  });
};

/**
 * Live occupants with attendance days for the bill month (for UI + billing filter).
 */
export const getLiveOccupantsWithAttendance = async (room, monthStr) => {
  const occupants = await getHistoryOccupantsForRoomMonth(room, monthStr);
  const fallbackAcademicYear = getAcademicYearForMonth(monthStr);
  const generatorShares = await buildGeneratorSharesForHostelMonth(room?.hostel, monthStr);

  const year = parseInt(monthStr.slice(0, 4));
  const month = parseInt(monthStr.slice(5, 7)) - 1;
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

  const filteredOccupants = occupants.filter((req) =>
    requestOverlapsBillMonth(req, monthStart, monthEnd)
  );

  const masterIds = filteredOccupants
    .map((r) => r.studentMasterId?._id || r.studentMasterId)
    .filter(Boolean);
  const masters = masterIds.length
    ? await StudentMaster.find({ _id: { $in: masterIds } })
        .select('admissionNumber name rollNumber userId studentPhone')
        .lean()
    : [];
  const masterById = new Map(masters.map((m) => [String(m._id), m]));

  const rows = [];
  for (const req of filteredOccupants) {
    const masterId = req.studentMasterId?._id || req.studentMasterId;
    const master =
      (req.studentMasterId && typeof req.studentMasterId === 'object' && req.studentMasterId.name
        ? req.studentMasterId
        : null) ||
      masterById.get(String(masterId)) ||
      {};
    const userId = master.userId || req.historyStudentId || null;
    const attendanceDays = userId
      ? await countPresentOrPartialDaysInMonth(userId, monthStr)
      : 0;

    const joinedDate = getJoinedDateFromRequest(req);
    const segmentEnd = asDate(req.segmentEndExclusive);
    const billingDays = getSegmentBillingDaysInMonth(
      joinedDate,
      segmentEnd,
      monthStart,
      year,
      month
    );

    const eligible = isEligibleForElectricityDemand(attendanceDays, {
      joinedDate,
      monthStart
    });

    const generatorShare = userId ? (generatorShares.byStudentId.get(String(userId)) || 0) : 0;

    rows.push({
      _id: userId || req._id,
      name: master.name || req.sdmsName || '',
      rollNumber: master.rollNumber || req.sdmsRollNumber || '',
      admissionNumber: req.admissionNumber,
      academicYear: req.academicYear || fallbackAcademicYear,
      bedNumber: req.bedNumber,
      lockerNumber: req.lockerNumber,
      enrollmentStatus: 'Active',
      hostelRequestStatus: req.status,
      hostelRequestId: req._id,
      studentPhone: master.studentPhone || null,
      attendanceDays,
      billingDays,
      segmentEndExclusive: segmentEnd ? segmentEnd.toISOString() : null,
      leftDate: req.leftDate ? (req.leftDate instanceof Date ? req.leftDate.toISOString() : new Date(req.leftDate).toISOString()) : null,
      eligibleForDemand: eligible,
      generatorShare,
      isPastJoiner: isPastJoinerForMonth(joinedDate, monthStart),
      joinedDate: joinedDate ? joinedDate.toISOString() : null
    });
  }
  return rows;
};

/**
 * Build ElectricityBill.studentBills from occupancy-history segments for the month.
 * Past-in-room / mid-month room join / mid-month transfer (exclusive end) supported.
 * Generator share is hostel-wide (diesel total split), looked up per student.
 */
export const buildStudentBillsForRoomMonth = async (room, monthStr, totalAmount) => {
  const fallbackAcademicYear = getAcademicYearForMonth(monthStr);
  const generatorShares = await buildGeneratorSharesForHostelMonth(room?.hostel, monthStr);
  const occupants = await getHistoryOccupantsForRoomMonth(room, monthStr);

  const year = parseInt(monthStr.slice(0, 4));
  const month = parseInt(monthStr.slice(5, 7)) - 1;
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

  const filteredOccupants = occupants.filter((req) =>
    requestOverlapsBillMonth(req, monthStart, monthEnd)
  );

  const masterIds = filteredOccupants
    .map((r) => r.studentMasterId?._id || r.studentMasterId)
    .filter(Boolean);

  const masters = masterIds.length
    ? await StudentMaster.find({ _id: { $in: masterIds } })
        .select('admissionNumber name rollNumber userId')
        .lean()
    : [];
  const masterById = new Map(masters.map((m) => [String(m._id), m]));

  const userIds = [
    ...new Set([
      ...masters.map((m) => m.userId).filter(Boolean).map(String),
      ...filteredOccupants.map((r) => r.historyStudentId).filter(Boolean).map(String)
    ])
  ];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } })
        .select('_id name rollNumber admissionNumber academicYear')
        .lean()
    : [];
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const eligibleRows = [];
  const ineligibleUserIds = [];

  for (const req of filteredOccupants) {
    const masterId = req.studentMasterId?._id || req.studentMasterId;
    const master =
      (req.studentMasterId && typeof req.studentMasterId === 'object' && req.studentMasterId.name
        ? req.studentMasterId
        : null) ||
      masterById.get(String(masterId)) ||
      {};

    const studentId = master.userId || req.historyStudentId;
    const user = studentId ? userById.get(String(studentId)) : null;
    if (!studentId) {
      console.warn(
        `[electricityBilling] No User linked for admission ${req.admissionNumber} — skipping`
      );
      continue;
    }

    const joinedDate = getJoinedDateFromRequest(req);
    const segmentEndExclusive = asDate(req.segmentEndExclusive);
    const attendanceDays = await countPresentOrPartialDaysInMonth(studentId, monthStr);
    if (
      !isEligibleForElectricityDemand(attendanceDays, {
        joinedDate,
        monthStart
      })
    ) {
      ineligibleUserIds.push(String(studentId));
      continue;
    }

    eligibleRows.push({
      studentId,
      studentName: master.name || req.sdmsName || user?.name || '',
      studentRollNumber: master.rollNumber || req.sdmsRollNumber || user?.rollNumber || '',
      admissionNumber: req.admissionNumber,
      hostelRequestId: req._id,
      academicYear: req.academicYear || fallbackAcademicYear,
      attendanceDays,
      joinedDate,
      segmentEndExclusive
    });
  }

  const hasNewJoining = eligibleRows.some((row) => {
    const days = getSegmentBillingDaysInMonth(
      row.joinedDate,
      row.segmentEndExclusive,
      monthStart,
      year,
      month
    );
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
    return days > 0 && days < totalDaysInMonth;
  });

  const elecSplit = splitAmountAmongEligibleRows(
    eligibleRows,
    totalAmount,
    monthStart,
    year,
    month,
    { hasNewJoining }
  );

  const studentBills = eligibleRows.map((row, idx) => {
    const electricityAmount = elecSplit.amounts[idx] || 0;
    const generatorAmount =
      generatorShares.byStudentId.get(String(row.studentId)) || 0;
    return {
      studentId: row.studentId,
      studentName: row.studentName,
      studentRollNumber: row.studentRollNumber,
      admissionNumber: row.admissionNumber,
      hostelRequestId: row.hostelRequestId,
      academicYear: row.academicYear,
      attendanceDays: row.attendanceDays,
      electricityAmount,
      generatorAmount,
      amount: electricityAmount + generatorAmount,
      nocAdjustment: 0,
      paymentStatus: 'unpaid'
    };
  });

  return {
    occupants: filteredOccupants,
    studentBills,
    ineligibleUserIds,
    occupantCount: occupants.length,
    eligibleCount: studentBills.length,
    sharePerStudent: elecSplit.meanShare,
    generatorAmount: generatorShares.meanShare,
    generatorTotal: generatorShares.total,
    academicYear: fallbackAcademicYear
  };
};

/**
 * Hostel-wide diesel generator total split among eligible students
 * (same eligibility + equal/mixed rules as electricity).
 */
export const buildGeneratorSharesForHostelMonth = async (hostelId, monthStr) => {
  const empty = {
    byStudentId: new Map(),
    total: 0,
    meanShare: 0,
    eligibleCount: 0,
    dieselLitres: 0,
    perLitreAmount: 0
  };
  if (!hostelId || !monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return empty;

  const hostel = hostelId?._id || hostelId;
  const generatorBill = await GeneratorBill.findOne({ month: monthStr, hostel }).lean();
  const total = resolveGeneratorTotal(generatorBill);
  if (total <= 0) {
    return {
      ...empty,
      dieselLitres: Number(generatorBill?.dieselLitres) || 0,
      perLitreAmount: Number(generatorBill?.perLitreAmount) || 0
    };
  }

  const year = parseInt(monthStr.slice(0, 4));
  const month = parseInt(monthStr.slice(5, 7)) - 1;
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const fallbackAcademicYear = getAcademicYearForMonth(monthStr);

  const requests = await HostelRequest.find({
    hostelId: hostel,
    status: { $in: ['active', 'expired'] }
  })
    .populate('studentMasterId', 'admissionNumber name rollNumber userId')
    .lean();

  const studentUserIds = requests
    .map((r) => String(r.studentMasterId?.userId || ''))
    .filter(Boolean);

  const nocs = studentUserIds.length
    ? await NOC.find({ student: { $in: studentUserIds }, status: 'Approved' }).lean()
    : [];
  const nocByStudentId = new Map(nocs.map((n) => [String(n.student), n]));

  const enrichedRequests = requests.map((req) => {
    const studentIdStr = String(req.studentMasterId?.userId || '');
    const studentNoc = studentIdStr ? nocByStudentId.get(studentIdStr) : null;
    const nocVacatingDate = studentNoc ? asDate(studentNoc.vacatingDate) : null;
    const requestLeftDate = asDate(req.leftDate) || asDate(req.expiredAt);

    const resolvedLeftDate = nocVacatingDate || requestLeftDate;

    const next = { ...req };
    if (resolvedLeftDate) {
      const exclusiveLeftEnd = new Date(resolvedLeftDate.getTime() + 24 * 60 * 60 * 1000);
      next.segmentEndExclusive = exclusiveLeftEnd;
      next.leftDate = resolvedLeftDate;
    }
    return next;
  });

  const filtered = enrichedRequests.filter((req) =>
    requestOverlapsBillMonth(req, monthStart, monthEnd)
  );

  const masterIds = filtered
    .map((r) => r.studentMasterId?._id || r.studentMasterId)
    .filter(Boolean);
  const masters = masterIds.length
    ? await StudentMaster.find({ _id: { $in: masterIds } })
        .select('admissionNumber name rollNumber userId')
        .lean()
    : [];
  const masterById = new Map(masters.map((m) => [String(m._id), m]));

  const eligibleRows = [];
  const seenStudents = new Set();

  for (const req of filtered) {
    const masterId = req.studentMasterId?._id || req.studentMasterId;
    const master =
      (req.studentMasterId && typeof req.studentMasterId === 'object' && req.studentMasterId.name
        ? req.studentMasterId
        : null) ||
      masterById.get(String(masterId)) ||
      {};
    const studentId = master.userId;
    if (!studentId) continue;
    const key = String(studentId);
    if (seenStudents.has(key)) continue;

    const joinedDate = getJoinedDateFromRequest(req);
    const attendanceDays = await countPresentOrPartialDaysInMonth(studentId, monthStr);
    if (
      !isEligibleForElectricityDemand(attendanceDays, {
        joinedDate,
        monthStart
      })
    ) {
      continue;
    }

    seenStudents.add(key);
    eligibleRows.push({
      studentId,
      attendanceDays,
      joinedDate,
      segmentEndExclusive: req.segmentEndExclusive ?? null,
      academicYear: req.academicYear || fallbackAcademicYear
    });
  }

  const hasNewJoining = filtered.some((req) => {
    const joined = getJoinedDateFromRequest(req);
    const end = req.segmentEndExclusive ?? null;
    const days = getSegmentBillingDaysInMonth(joined, end, monthStart, year, month);
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
    return days > 0 && days < totalDaysInMonth;
  });

  const split = splitAmountAmongEligibleRows(
    eligibleRows,
    total,
    monthStart,
    year,
    month,
    { hasNewJoining }
  );
  const byStudentId = new Map();
  eligibleRows.forEach((row, idx) => {
    byStudentId.set(String(row.studentId), split.amounts[idx] || 0);
  });

  return {
    byStudentId,
    total,
    meanShare: split.meanShare,
    eligibleCount: eligibleRows.length,
    dieselLitres: Number(generatorBill?.dieselLitres) || 0,
    perLitreAmount: Number(generatorBill?.perLitreAmount) || 0,
    hasNewJoining: split.hasNewJoining,
    totalBillingDays: split.totalBillingDays
  };
};

export const loadElectricitySettings = async () => {
  const settings = await ElectricitySettings.getOrCreate();
  Room.setDefaultElectricityRate(Number(settings.defaultRate) || 5);
  return settings;
};

export const listFeeHeadsFromFeesDb = async () => {
  if (!isFeesDbConfigured()) {
    return { ok: false, reason: 'fees_db_not_configured', feeHeads: [] };
  }
  await connectFeesDatabase();
  const conn = getFeesConnection();
  if (!conn) {
    return { ok: false, reason: 'fees_db_not_connected', feeHeads: [] };
  }

  const feeHeads = await conn.db
    .collection(FEE_HEADS_COLLECTION)
    .find({})
    .project({ code: 1, name: 1, description: 1 })
    .sort({ code: 1 })
    .toArray();

  return {
    ok: true,
    feeHeads: feeHeads.map((h) => ({
      _id: String(h._id),
      code: h.code || '',
      name: h.name || '',
      description: h.description || ''
    }))
  };
};

const ensureFeesReady = async () => {
  if (!isFeesDbConfigured()) return false;
  await connectFeesDatabase();
  return Boolean(getFeesConnection());
};

/**
 * Upsert Fees DB studentfees demand for one student under the configured electricity fee head.
 * Unique key is studentId+feeHead+academicYear — amount is the share for this bill month
 * adjusted against any previous share for the same month (via delta from oldStudentBills).
 *
 * options.createIfMissing — only insert when no row exists (used by Sync on raised bills).
 */
export const upsertElectricityFeeDemand = async ({
  studentDoc,
  feeHeadId,
  academicYear,
  amount,
  previousAmount = 0,
  createIfMissing = false,
  roomNumber = '',
  billTotal = 0,
  month = '',
  electricityAmount = 0,
  generatorAmount = 0
}) => {
  if (!(await ensureFeesReady())) {
    return { skipped: true, reason: 'fees_db_not_configured' };
  }
  if (!feeHeadId || !academicYear) {
    return { skipped: true, reason: 'missing_fee_head_or_academic_year' };
  }

  const plain = studentDoc?.toObject ? studentDoc.toObject() : { ...studentDoc };
  const enriched = await enrichStudentAcademics(plain);
  const feesAcademicYear = toFeesAcademicYear(academicYear);
  const studentId = resolveFeesStudentId(plain, enriched);

  if (!studentId || !feesAcademicYear) {
    return { skipped: true, reason: 'missing_admission_number', rollNumber: plain.rollNumber };
  }

  const StudentFee = getStudentFeeModel();
  const headObjectId = mongoose.Types.ObjectId.isValid(feeHeadId)
    ? new mongoose.Types.ObjectId(feeHeadId)
    : feeHeadId;

  const existing = await StudentFee.findOne({
    studentId,
    feeHead: headObjectId,
    academicYear: feesAcademicYear
  }).lean();

  if (createIfMissing && existing) {
    return { skipped: true, reason: 'already_exists', studentId, amount: existing.amount };
  }

  const prev = Number(previousAmount) || 0;
  const nextShare = Number(amount) || 0;
  const currentTotal = Number(existing?.amount) || 0;
  const newTotal = createIfMissing
    ? Math.max(0, nextShare)
    : Math.max(0, currentTotal - prev + nextShare);

  if (newTotal <= 0 && !existing) {
    return { skipped: true, reason: 'zero_amount' };
  }

  const payload = buildStudentFeePayload(
    plain,
    enriched,
    headObjectId,
    academicYear,
    newTotal,
    {
      remarks: buildElectricityDemandRemarks({
        month,
        roomNumber,
        electricityAmount,
        generatorAmount,
        totalAmount: nextShare,
        roomElectricityTotal: billTotal
      })
    }
  );

  if (newTotal <= 0) {
    await StudentFee.deleteOne({
      studentId,
      feeHead: headObjectId,
      academicYear: feesAcademicYear
    });
    return { ok: true, deleted: true, studentId };
  }

  const result = await StudentFee.findOneAndUpdate(
    {
      studentId,
      feeHead: headObjectId,
      academicYear: feesAcademicYear
    },
    {
      $set: payload,
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true, new: true, runValidators: false }
  );

  return {
    ok: true,
    id: result._id,
    studentId,
    amount: newTotal,
    created: !existing
  };
};

/** Hard-delete electricity fee demand row for a student (ineligible / sync cleanup). */
export const deleteElectricityFeeDemand = async ({
  studentDoc,
  feeHeadId,
  academicYear
}) => {
  if (!(await ensureFeesReady())) {
    return { skipped: true, reason: 'fees_db_not_configured' };
  }
  if (!feeHeadId || !academicYear) {
    return { skipped: true, reason: 'missing_fee_head_or_academic_year' };
  }

  const plain = studentDoc?.toObject ? studentDoc.toObject() : { ...studentDoc };
  const enriched = await enrichStudentAcademics(plain);
  const feesAcademicYear = toFeesAcademicYear(academicYear);
  const studentId = resolveFeesStudentId(plain, enriched);
  if (!studentId || !feesAcademicYear) {
    return { skipped: true, reason: 'missing_admission_number' };
  }

  const StudentFee = getStudentFeeModel();
  const headObjectId = mongoose.Types.ObjectId.isValid(feeHeadId)
    ? new mongoose.Types.ObjectId(feeHeadId)
    : feeHeadId;

  const res = await StudentFee.deleteOne({
    studentId,
    feeHead: headObjectId,
    academicYear: feesAcademicYear
  });

  return { ok: true, deleted: res.deletedCount > 0, studentId };
};

const resolveStudentDocForDemand = async (billRow, occupantRequest) => {
  const user = await User.findById(billRow.studentId).lean();
  if (user) {
    return {
      ...user,
      academicYear: occupantRequest?.academicYear || user.academicYear,
      admissionNumber: user.admissionNumber || billRow.admissionNumber || occupantRequest?.admissionNumber
    };
  }

  return {
    _id: billRow.studentId,
    name: billRow.studentName,
    rollNumber: billRow.studentRollNumber,
    admissionNumber: billRow.admissionNumber || occupantRequest?.admissionNumber,
    academicYear: occupantRequest?.academicYear,
    course: occupantRequest?.sdmsCourse,
    branch: occupantRequest?.sdmsBranch,
    year: occupantRequest?.sdmsYearOfStudy,
    college: occupantRequest?.sdmsCollegeName
  };
};

/**
 * After saving a room bill: write studentBills + sync fee demands.
 */
export const applyOccupantsAndSyncDemands = async ({
  room,
  month,
  total,
  previousStudentBills = []
}) => {
  const settings = await ElectricitySettings.getOrCreate();
  const breakdown = await buildStudentBillsForRoomMonth(room, month, total);

  const prevByStudent = new Map(
    (previousStudentBills || []).map((sb) => [
      String(sb.studentId?._id || sb.studentId),
      {
        amount: Number(sb.amount) || 0,
        electricityAmount: Number(sb.electricityAmount) || Number(sb.amount) || 0,
        generatorAmount: Number(sb.generatorAmount) || 0
      }
    ])
  );

  const demandResults = [];
  if (ELECTRICITY_FEE_SYNC_ENABLED && settings.feeHeadId) {
    const occupantByUserId = new Map();
    for (const req of breakdown.occupants) {
      const master = req.studentMasterId;
      const userId = master?.userId || null;
      if (userId) occupantByUserId.set(String(userId), req);
    }

    // Remove demands for live occupants below attendance threshold
    for (const userId of breakdown.ineligibleUserIds || []) {
      const req = breakdown.occupants.find((o) => {
        const uid = o.studentMasterId?.userId;
        return uid && String(uid) === String(userId);
      });
      const academicYear = req?.academicYear || breakdown.academicYear;
      if (!academicYear) continue;
      try {
        const studentDoc = await resolveStudentDocForDemand(
          { studentId: userId, admissionNumber: req?.admissionNumber },
          { academicYear, admissionNumber: req?.admissionNumber }
        );
        const del = await deleteElectricityFeeDemand({
          studentDoc: { ...studentDoc, academicYear },
          feeHeadId: settings.feeHeadId,
          academicYear
        });
        demandResults.push({ studentId: String(userId), ...del, reason: 'below_attendance_threshold' });
      } catch (err) {
        demandResults.push({ studentId: String(userId), ok: false, error: err.message });
      }
    }

    // Also process students removed from this month's bill (reduce demand)
    const currentIds = new Set(breakdown.studentBills.map((sb) => String(sb.studentId)));
    for (const [studentId, prevAmount] of prevByStudent.entries()) {
      if (currentIds.has(studentId)) continue;
      if ((breakdown.ineligibleUserIds || []).includes(String(studentId))) continue;
      const studentDoc = await resolveStudentDocForDemand(
        { studentId, amount: 0, admissionNumber: null },
        null
      );
      const academicYear =
        getAcademicYearForMonth(month) || toFeesAcademicYear(studentDoc.academicYear);
      const result = await upsertElectricityFeeDemand({
        studentDoc,
        feeHeadId: settings.feeHeadId,
        academicYear,
        amount: 0,
        previousAmount: prevAmount.amount,
        roomNumber: room.roomNumber,
        billTotal: total,
        month,
        electricityAmount: 0,
        generatorAmount: 0
      });
      demandResults.push({ studentId, ...result });
    }

    for (const sb of breakdown.studentBills) {
      const req = occupantByUserId.get(String(sb.studentId));
      const studentDoc = await resolveStudentDocForDemand(sb, req);
      const academicYear = sb.academicYear || breakdown.academicYear;
      const previousAmount = prevByStudent.get(String(sb.studentId))?.amount || 0;
      try {
        const result = await upsertElectricityFeeDemand({
          studentDoc,
          feeHeadId: settings.feeHeadId,
          academicYear,
          amount: sb.amount,
          previousAmount,
          roomNumber: room.roomNumber,
          billTotal: total,
          month,
          electricityAmount: sb.electricityAmount,
          generatorAmount: sb.generatorAmount
        });
        demandResults.push({ studentId: String(sb.studentId), ...result });
      } catch (err) {
        console.error(
          `[electricityBilling] Demand sync failed for ${sb.studentRollNumber}:`,
          err.message
        );
        demandResults.push({
          studentId: String(sb.studentId),
          ok: false,
          error: err.message
        });
      }
    }
  } else {
    console.warn(
      '[electricityBilling] No electricity fee head configured — studentBills saved without Fees DB demand'
    );
  }

  // Strip helper fields not in Room schema before embedding; preserve payment state
  const prevPaymentByStudent = new Map(
    (previousStudentBills || []).map((sb) => [
      String(sb.studentId?._id || sb.studentId),
      {
        paymentStatus: sb.paymentStatus || 'unpaid',
        paymentId: sb.paymentId || null,
        paidAt: sb.paidAt || null,
        nocAdjustment: sb.nocAdjustment || 0
      }
    ])
  );

  const studentBillsForRoom = breakdown.studentBills.map(
    ({ admissionNumber, hostelRequestId, academicYear, attendanceDays, ...rest }) => {
      const prev = prevPaymentByStudent.get(String(rest.studentId));
      if (!prev) return rest;
      return {
        ...rest,
        paymentStatus: prev.paymentStatus,
        paymentId: prev.paymentId,
        paidAt: prev.paidAt,
        nocAdjustment: prev.nocAdjustment
      };
    }
  );

  return {
    studentBills: studentBillsForRoom,
    occupantCount: breakdown.occupantCount,
    eligibleCount: breakdown.eligibleCount,
    sharePerStudent: breakdown.sharePerStudent,
    generatorAmount: breakdown.generatorAmount,
    academicYear: breakdown.academicYear,
    feeHeadConfigured: Boolean(settings.feeHeadId),
    demandResults
  };
};

/**
 * Sync Fees DB demands for an already-raised bill.
 * Rebuilds studentBills from live eligible occupants (>5 present/partial days),
 * removes demands for ineligible students, and updates share amounts for eligible ones.
 */
export const syncExistingBillFeeDemands = async ({ room, month }) => {
  if (!ELECTRICITY_FEE_SYNC_ENABLED) {
    return {
      ok: false,
      reason: 'fee_sync_disabled',
      message: 'Electricity fee demand sync is currently disabled (ELECTRICITY_FEE_SYNC_ENABLED = false).'
    };
  }

  const settings = await ElectricitySettings.getOrCreate();
  if (!settings.feeHeadId) {
    return {
      ok: false,
      reason: 'fee_head_not_configured',
      message: 'Select and save an electricity fee head in Settings first.'
    };
  }

  if (!(await ensureFeesReady())) {
    return {
      ok: false,
      reason: 'fees_db_not_configured',
      message: 'Fees database is not configured or not connected.'
    };
  }

  let bill = await ElectricityBill.findOne({ room: room._id, month });
  if (!bill) {
    return {
      ok: false,
      reason: 'bill_not_found',
      message: `No electricity bill found for this room in ${month}.`
    };
  }

  const previousStudentBills = [...(bill.studentBills || [])];
  const prevAmountByStudent = new Map(
    previousStudentBills.map((sb) => [
      String(sb.studentId?._id || sb.studentId),
      {
        amount: Number(sb.amount) || 0,
        electricityAmount: Number(sb.electricityAmount) || Number(sb.amount) || 0,
        generatorAmount: Number(sb.generatorAmount) || 0
      }
    ])
  );

  // Always refresh shares from live active occupants who meet attendance rule
  const breakdown = await buildStudentBillsForRoomMonth(room, month, bill.total);
  const studentBills = breakdown.studentBills.map(
    ({ admissionNumber, hostelRequestId, academicYear, attendanceDays, ...rest }) => rest
  );

  const studentBillsForDemand = breakdown.studentBills;

  const prevPaymentByStudent = new Map(
    previousStudentBills.map((sb) => [
      String(sb.studentId?._id || sb.studentId),
      {
        paymentStatus: sb.paymentStatus || 'unpaid',
        paymentId: sb.paymentId || null,
        paidAt: sb.paidAt || null,
        nocAdjustment: sb.nocAdjustment || 0
      }
    ])
  );

  bill.studentBills = studentBills.map((rest) => {
    const prev = prevPaymentByStudent.get(String(rest.studentId));
    if (!prev) return rest;
    return { ...rest, ...prev };
  });
  await bill.save();

  const fallbackAcademicYear =
    breakdown.academicYear || getAcademicYearForMonth(month);
  const demandResults = [];
  let created = 0;
  let updated = 0;
  let removed = 0;
  let failed = 0;

  // Remove demands for live occupants who are NOT eligible (>5 present/partial days)
  for (const userId of breakdown.ineligibleUserIds || []) {
    const req = breakdown.occupants.find((o) => {
      const uid = o.studentMasterId?.userId || null;
      return uid && String(uid) === String(userId);
    });
    const academicYear = req?.academicYear || fallbackAcademicYear;
    if (!academicYear) continue;
    try {
      const studentDoc = await resolveStudentDocForDemand(
        { studentId: userId, admissionNumber: req?.admissionNumber },
        { academicYear, admissionNumber: req?.admissionNumber }
      );
      const del = await deleteElectricityFeeDemand({
        studentDoc: { ...studentDoc, academicYear },
        feeHeadId: settings.feeHeadId,
        academicYear
      });
      demandResults.push({ studentId: String(userId), ...del, reason: 'below_attendance_threshold' });
      if (del.deleted) removed += 1;
    } catch (err) {
      failed += 1;
      demandResults.push({ studentId: String(userId), ok: false, error: err.message });
    }
  }

  // Students who were on the old bill but are no longer live occupants — reduce their demand
  const currentIds = new Set(studentBillsForDemand.map((sb) => String(sb.studentId)));
  const ineligibleSet = new Set((breakdown.ineligibleUserIds || []).map(String));
  for (const [studentId, prevAmount] of prevAmountByStudent.entries()) {
    if (currentIds.has(studentId) || ineligibleSet.has(studentId)) continue;
    if (!(prevAmount?.amount > 0)) continue;
    try {
      const studentDoc = await resolveStudentDocForDemand(
        { studentId, amount: 0, admissionNumber: null },
        null
      );
      const academicYear =
        fallbackAcademicYear || toFeesAcademicYear(studentDoc.academicYear);
      if (!academicYear) {
        failed += 1;
        continue;
      }
      const result = await upsertElectricityFeeDemand({
        studentDoc,
        feeHeadId: settings.feeHeadId,
        academicYear,
        amount: 0,
        previousAmount: prevAmount.amount,
        createIfMissing: false,
        roomNumber: room.roomNumber,
        billTotal: Number(bill.total) || 0,
        month,
        electricityAmount: 0,
        generatorAmount: 0
      });
      demandResults.push({ studentId, ...result, reason: 'removed_from_bill' });
      if (result.deleted || result.ok) removed += 1;
    } catch (err) {
      failed += 1;
      demandResults.push({ studentId, ok: false, error: err.message });
    }
  }

  // Create or UPDATE demands for eligible students with recalculated shares.
  // newTotal = currentDemand - previousBillShare + newShare (same as bill save).
  // If a prior Sync already rewrote bill.studentBills but skipped demand updates,
  // recover by treating the old equal-split among all live occupants as previousShare.
  const equalLiveShare =
    breakdown.occupantCount > 0
      ? roundShare(Number(bill.total) || 0, breakdown.occupantCount) + (breakdown.generatorAmount || 0)
      : 0;
  const StudentFee = getStudentFeeModel();
  const headObjectId = mongoose.Types.ObjectId.isValid(settings.feeHeadId)
    ? new mongoose.Types.ObjectId(settings.feeHeadId)
    : settings.feeHeadId;

  for (const sb of studentBillsForDemand) {
    const academicYear = sb.academicYear || fallbackAcademicYear || null;
    if (!academicYear) {
      failed += 1;
      demandResults.push({
        studentId: String(sb.studentId),
        skipped: true,
        reason: 'missing_academic_year'
      });
      continue;
    }

    const studentDoc = await resolveStudentDocForDemand(sb, {
      academicYear,
      admissionNumber: sb.admissionNumber
    });
    let previousAmount = prevAmountByStudent.get(String(sb.studentId))?.amount || 0;
    const newShare = Number(sb.amount) || 0;

    // Half-sync recovery: bill shares already match new calc, but Fees DB may still
    // hold the older equal split among all live students.
    if (
      Math.abs(previousAmount - newShare) < 0.009 &&
      breakdown.occupantCount > breakdown.eligibleCount &&
      equalLiveShare > 0
    ) {
      try {
        const plain = studentDoc?.toObject ? studentDoc.toObject() : { ...studentDoc };
        const enriched = await enrichStudentAcademics(plain);
        const feesAcademicYear = toFeesAcademicYear(academicYear);
        const feesStudentId = resolveFeesStudentId(plain, enriched);
        if (feesStudentId && feesAcademicYear) {
          const existing = await StudentFee.findOne({
            studentId: feesStudentId,
            feeHead: headObjectId,
            academicYear: feesAcademicYear
          }).lean();
          const existingAmt = Number(existing?.amount) || 0;
          if (Math.abs(existingAmt - equalLiveShare) < 0.05 * Math.max(equalLiveShare, 1)) {
            previousAmount = equalLiveShare;
          }
        }
      } catch {
        // Fall through with bill previousAmount
      }
    }

    try {
      const result = await upsertElectricityFeeDemand({
        studentDoc: { ...studentDoc, academicYear },
        feeHeadId: settings.feeHeadId,
        academicYear,
        amount: newShare,
        previousAmount,
        createIfMissing: false,
        roomNumber: room.roomNumber,
        billTotal: Number(bill.total) || 0,
        month,
        electricityAmount: sb.electricityAmount,
        generatorAmount: sb.generatorAmount
      });
      demandResults.push({
        studentId: String(sb.studentId),
        ...result,
        previousAmount,
        newShare
      });
      if (result.created) created += 1;
      else if (result.ok) updated += 1;
      else if (result.skipped) failed += 1;
    } catch (err) {
      failed += 1;
      demandResults.push({
        studentId: String(sb.studentId),
        ok: false,
        error: err.message
      });
    }
  }

  // Attach demand outcome onto eligible student rows for the sync-result UI
  const demandByStudent = new Map();
  for (const r of demandResults) {
    if (r?.studentId) demandByStudent.set(String(r.studentId), r);
  }

  const eligibleStudents = studentBillsForDemand.map((sb) => {
    const demand = demandByStudent.get(String(sb.studentId));
    let demandStatus = 'pending';
    if (demand?.created) demandStatus = 'created';
    else if (demand?.ok && !demand?.deleted) demandStatus = 'updated';
    else if (demand?.deleted) demandStatus = 'removed';
    else if (demand?.skipped) demandStatus = 'skipped';
    else if (demand?.ok === false || demand?.error) demandStatus = 'failed';

    return {
      studentId: String(sb.studentId),
      name: sb.studentName || '',
      rollNumber: sb.studentRollNumber || '',
      admissionNumber: sb.admissionNumber || '',
      academicYear: sb.academicYear || fallbackAcademicYear,
      attendanceDays: sb.attendanceDays ?? null,
      share: Number(sb.amount) || 0,
      electricityShare: Number(sb.electricityAmount) || 0,
      generatorShare: Number(sb.generatorAmount) || 0,
      previousShare: prevAmountByStudent.get(String(sb.studentId))?.amount || 0,
      demandStatus,
      demandAmount: demand?.amount ?? null
    };
  });

  const ineligibleStudents = [];
  for (const userId of breakdown.ineligibleUserIds || []) {
    const req = breakdown.occupants.find((o) => {
      const uid = o.studentMasterId?.userId || null;
      return uid && String(uid) === String(userId);
    });
    const master = req?.studentMasterId;
    ineligibleStudents.push({
      studentId: String(userId),
      name: master?.name || req?.sdmsName || '',
      rollNumber: master?.rollNumber || req?.sdmsRollNumber || '',
      admissionNumber: req?.admissionNumber || '',
      academicYear: req?.academicYear || fallbackAcademicYear,
      reason: 'below_attendance_threshold'
    });
  }

  const billSummary = {
    month,
    roomNumber: room.roomNumber,
    roomId: String(room._id),
    total: Number(bill.total) || 0,
    units: bill.units ?? null,
    rate: bill.rate ?? null,
    meterType: bill.meterType || room.meterType || null,
    startUnits: bill.startUnits ?? null,
    endUnits: bill.endUnits ?? null,
    meter1StartUnits: bill.meter1StartUnits ?? null,
    meter1EndUnits: bill.meter1EndUnits ?? null,
    meter2StartUnits: bill.meter2StartUnits ?? null,
    meter2EndUnits: bill.meter2EndUnits ?? null,
    sharePerStudent: breakdown.sharePerStudent,
    generatorAmount: breakdown.generatorAmount,
    totalPerStudent: breakdown.sharePerStudent + breakdown.generatorAmount,
    eligibleCount: breakdown.eligibleCount,
    occupantCount: breakdown.occupantCount,
    ineligibleCount: ineligibleStudents.length
  };

  return {
    ok: true,
    feeHeadId: settings.feeHeadId,
    feeHeadCode: settings.feeHeadCode,
    feeHeadName: settings.feeHeadName,
    academicYear: fallbackAcademicYear,
    occupantCount: breakdown.occupantCount,
    eligibleCount: breakdown.eligibleCount,
    sharePerStudent: breakdown.sharePerStudent,
    generatorAmount: breakdown.generatorAmount,
    minAttendanceDays: MIN_ATTENDANCE_DAYS_FOR_ELECTRICITY_DEMAND,
    created,
    updated,
    removed,
    failed,
    demandResults,
    bill: billSummary,
    eligibleStudents,
    ineligibleStudents
  };
};

/**
 * Delete electricity bills for a month and reverse each student's fee demand
 * by subtracting that bill's share (amount: 0, previousAmount: share).
 * If the demand drops to 0, the Fees DB row is deleted.
 */
export const clearMonthBillsAndReverseDemands = async ({
  month,
  hostel = null,
  category = null
}) => {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return {
      ok: false,
      reason: 'invalid_month',
      message: 'A valid month in YYYY-MM format is required.'
    };
  }

  const roomQuery = {};
  if (hostel) roomQuery.hostel = hostel;
  if (category) roomQuery.category = category;

  let billQuery = { month };
  if (Object.keys(roomQuery).length > 0) {
    const roomIds = await Room.find(roomQuery).distinct('_id');
    billQuery = { month, room: { $in: roomIds } };
  }

  const bills = await ElectricityBill.find(billQuery).lean();
  if (!bills.length) {
    return {
      ok: true,
      deletedBills: 0,
      demandsReversed: 0,
      demandsDeleted: 0,
      demandsFailed: 0,
      demandResults: [],
      message: `No electricity bills found for ${month}.`
    };
  }

  const settings = await ElectricitySettings.getOrCreate();
  const fallbackAcademicYear = getAcademicYearForMonth(month);
  const demandResults = [];
  let demandsReversed = 0;
  let demandsDeleted = 0;
  let demandsFailed = 0;
  let demandsSkipped = 0;

  if (settings.feeHeadId && (await ensureFeesReady())) {
    for (const bill of bills) {
      for (const sb of bill.studentBills || []) {
        const share = Number(sb.amount) || 0;
        if (share <= 0) continue;

        const studentId = sb.studentId?._id || sb.studentId;
        if (!studentId) {
          demandsFailed += 1;
          demandResults.push({
            roomNumber: bill.roomNumber,
            skipped: true,
            reason: 'missing_student_id'
          });
          continue;
        }

        try {
          const studentDoc = await resolveStudentDocForDemand(
            {
              studentId,
              studentName: sb.studentName,
              studentRollNumber: sb.studentRollNumber,
              admissionNumber: sb.admissionNumber
            },
            null
          );
          const academicYear =
            fallbackAcademicYear || toFeesAcademicYear(studentDoc.academicYear);
          if (!academicYear) {
            demandsFailed += 1;
            demandResults.push({
              studentId: String(studentId),
              roomNumber: bill.roomNumber,
              skipped: true,
              reason: 'missing_academic_year'
            });
            continue;
          }

          // Reverse this month's share: newTotal = current - share + 0
          const result = await upsertElectricityFeeDemand({
            studentDoc: { ...studentDoc, academicYear },
            feeHeadId: settings.feeHeadId,
            academicYear,
            amount: 0,
            previousAmount: share,
            createIfMissing: false,
            roomNumber: bill.roomNumber,
            billTotal: Number(bill.total) || 0,
            month,
            electricityAmount: 0,
            generatorAmount: 0
          });

          demandResults.push({
            studentId: String(studentId),
            studentName: sb.studentName,
            studentRollNumber: sb.studentRollNumber,
            roomNumber: bill.roomNumber,
            reversedShare: share,
            ...result
          });

          if (result.deleted) demandsDeleted += 1;
          else if (result.ok) demandsReversed += 1;
          else if (result.skipped) demandsSkipped += 1;
          else demandsFailed += 1;
        } catch (err) {
          demandsFailed += 1;
          demandResults.push({
            studentId: String(studentId),
            roomNumber: bill.roomNumber,
            ok: false,
            error: err.message
          });
        }
      }
    }
  } else if (!settings.feeHeadId) {
    console.warn(
      '[electricityBilling] Remove Month: no fee head configured — bills deleted without reversing demands'
    );
  }

  const deleteResult = await ElectricityBill.deleteMany(billQuery);

  return {
    ok: true,
    month,
    deletedBills: deleteResult.deletedCount || 0,
    demandsReversed,
    demandsDeleted,
    demandsFailed,
    demandsSkipped,
    feeHeadConfigured: Boolean(settings.feeHeadId),
    demandResults,
    message: `Deleted ${deleteResult.deletedCount || 0} bill(s) for ${month}; reversed ${demandsReversed + demandsDeleted} student demand(s).`
  };
};

// Re-export buildStudentFeePayload usage needs — export for tests
export { resolveFeesStudentId };
