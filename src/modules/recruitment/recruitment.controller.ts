import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';

import { ApiResponse } from '../../utils/ApiResponse';
import ImageKit from 'imagekit';

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY!,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT!
});



// Candidates
export const getAllCandidates = async (req: Request, res: Response) => {
  try {
    const candidates = await prisma.candidate.findMany({
      include: { jobRole: true },
      orderBy: { createdAt: 'desc' }
    });
    return res.status(200).json(new ApiResponse(true, "Success", candidates));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const createCandidate = async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, jobRoleId } = req.body;
    let { resumeLink } = req.body;
    
    // Check if candidate exists
    const existing = await prisma.candidate.findUnique({
      where: { email }
    });

    if (existing) {
      return res.status(400).json(new ApiResponse(false, "Candidate with this email already exists."));
    }

    if (req.file) {
      const file = req.file;
      const uploadResponse = await imagekit.upload({
        file: file.buffer,
        fileName: file.originalname,
        folder: '/hrms_resumes',
        useUniqueFileName: true
      });
      resumeLink = uploadResponse.url;
    }

    const candidate = await prisma.candidate.create({
      data: {
        firstName,
        lastName,
        email,
        jobRoleId,
        resumeLink,
        interviewStatus: "PENDING",
        status: "IN_PROGRESS"
      },
      include: { jobRole: true }
    });

    return res.status(201).json(new ApiResponse(true, "Candidate created successfully", candidate));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateCandidate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { interviewStatus, status, jobRoleId } = req.body;
    
    const candidate = await prisma.candidate.update({
      where: { id },
      data: {
        ...(interviewStatus && { interviewStatus }),
        ...(status && { status }),
        ...(jobRoleId && { jobRoleId }),
      },
      include: { jobRole: true }
    });

    return res.status(200).json(new ApiResponse(true, "Candidate updated successfully", candidate));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const deleteCandidate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.candidate.delete({ where: { id } });
    return res.status(200).json(new ApiResponse(true, "Candidate deleted successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

// Job Roles
export const getAllJobRoles = async (req: Request, res: Response) => {
  try {
    const roles = await prisma.jobRole.findMany({
      orderBy: { title: 'asc' }
    });
    return res.status(200).json(new ApiResponse(true, "Success", roles));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const createJobRole = async (req: Request, res: Response) => {
  try {
    const { title, description } = req.body;
    
    const existing = await prisma.jobRole.findUnique({
      where: { title }
    });

    if (existing) {
      return res.status(400).json(new ApiResponse(false, "Job role already exists.", existing));
    }

    const role = await prisma.jobRole.create({
      data: { title, description }
    });

    return res.status(201).json(new ApiResponse(true, "Job role created successfully", role));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
