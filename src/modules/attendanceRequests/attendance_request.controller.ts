import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';

import { ApiResponse } from '../../utils/ApiResponse';



export const getAll = async (req: Request, res: Response) => {
  try {
    const data = await prisma.attendanceCorrection.findMany();
    return res.status(200).json(new ApiResponse(true, "Fetched successfully", data));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const create = async (req: Request, res: Response) => {
  try {
    const data = await prisma.attendanceCorrection.create({ data: req.body });
    return res.status(201).json(new ApiResponse(true, "Created successfully", data));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
