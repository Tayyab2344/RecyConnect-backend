import prisma from '../lib/prisma.js';
import { sendSuccess, sendError, sendPaginated } from '../utils/responseHelper.js';
import { getPaginationParams } from '../utils/queryHelper.js';
import { logActivity } from '../utils/activityLogger.js';

/**
 * Submit a complaint (any authenticated user)
 * POST /api/complaints
 */
export async function submitComplaint(req, res) {
  try {
    const userId = req.user.id;
    const { category, description } = req.body;

    if (!category || !description) {
      return sendError(res, 'Category and description are required', null, 400);
    }

    if (description.length < 10) {
      return sendError(res, 'Description must be at least 10 characters', null, 400);
    }

    const complaint = await prisma.complaint.create({
      data: {
        userId,
        category,
        description,
        status: 'PENDING',
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    await logActivity({
      userId,
      action: 'COMPLAINT_SUBMITTED',
      resourceType: 'complaint',
      resourceId: complaint.id.toString(),
      meta: { category, descriptionLength: description.length },
      req,
    });

    sendSuccess(res, 'Complaint submitted successfully', complaint, 201);
  } catch (err) {
    sendError(res, 'Failed to submit complaint', err);
  }
}

/**
 * Get user's own complaints
 * GET /api/complaints/my
 */
export async function getMyComplaints(req, res) {
  try {
    const userId = req.user.id;

    const complaints = await prisma.complaint.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    sendSuccess(res, 'Complaints fetched', complaints);
  } catch (err) {
    sendError(res, 'Failed to fetch complaints', err);
  }
}

/**
 * Admin: Get all complaints with filters
 * GET /api/admin/complaints
 */
export async function getAllComplaints(req, res) {
  try {
    const { status, category, page = 1, limit = 25 } = req.query;
    const where = {};

    if (status) where.status = status;
    if (category) where.category = { equals: category, mode: 'insensitive' };

    const totalCount = await prisma.complaint.count({ where });
    const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);

    const complaints = await prisma.complaint.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, contactNo: true } },
      },
    });

    sendPaginated(res, complaints, totalCount, pageNum, limitNum);
  } catch (err) {
    sendError(res, 'Failed to fetch complaints', err);
  }
}

/**
 * Admin: Update complaint status (resolve, dismiss, review)
 * PUT /api/admin/complaints/:id
 */
export async function updateComplaintStatus(req, res) {
  try {
    const { id } = req.params;
    const adminId = req.user.id;
    const { status, adminNotes } = req.body;

    const validStatuses = ['PENDING', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'];
    if (!validStatuses.includes(status)) {
      return sendError(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`, null, 400);
    }

    const existing = await prisma.complaint.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      return sendError(res, 'Complaint not found', null, 404);
    }

    const updateData = {
      status,
      adminNotes: adminNotes || existing.adminNotes,
    };

    if (status === 'RESOLVED' || status === 'DISMISSED') {
      updateData.resolvedAt = new Date();
      updateData.resolvedBy = adminId;
    }

    const updated = await prisma.complaint.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    await logActivity({
      userId: adminId,
      action: `COMPLAINT_${status}`,
      resourceType: 'complaint',
      resourceId: id,
      meta: { previousStatus: existing.status, newStatus: status, adminNotes },
      req,
    });

    sendSuccess(res, `Complaint ${status.toLowerCase()} successfully`, updated);
  } catch (err) {
    sendError(res, 'Failed to update complaint', err);
  }
}

/**
 * Admin: Delete a complaint
 * DELETE /api/admin/complaints/:id
 */
export async function deleteComplaint(req, res) {
  try {
    const { id } = req.params;
    const adminId = req.user.id;

    const existing = await prisma.complaint.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      return sendError(res, 'Complaint not found', null, 404);
    }

    await prisma.complaint.delete({ where: { id: parseInt(id) } });

    await logActivity({
      userId: adminId,
      action: 'COMPLAINT_DELETED',
      resourceType: 'complaint',
      resourceId: id,
      meta: { category: existing.category, description: existing.description },
      req,
    });

    sendSuccess(res, 'Complaint deleted successfully');
  } catch (err) {
    sendError(res, 'Failed to delete complaint', err);
  }
}
