import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';

export const getAll = async (req: Request, res: Response) => {
  try {
    const data = await prisma.holiday.findMany({ orderBy: { date: 'asc' } });
    return res.status(200).json(new ApiResponse(true, "Holidays fetched successfully", data));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const create = async (req: Request, res: Response) => {
  try {
    const { name, date, type = 'NATIONAL', description } = req.body;
    if (!name || !date) {
      return res.status(400).json(new ApiResponse(false, "Holiday name and date are required"));
    }

    const data = await prisma.holiday.create({
      data: {
        name: name.trim(),
        date: new Date(date),
        type: type || 'NATIONAL',
        description: description?.trim() || null
      }
    });

    return res.status(201).json(new ApiResponse(true, "Holiday created successfully", data));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const update = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, date, type, description } = req.body;

    const data = await prisma.holiday.update({
      where: { id },
      data: {
        name: name ? name.trim() : undefined,
        date: date ? new Date(date) : undefined,
        type: type || undefined,
        description: description !== undefined ? (description?.trim() || null) : undefined
      }
    });

    return res.status(200).json(new ApiResponse(true, "Holiday updated successfully", data));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.holiday.delete({ where: { id } });
    return res.status(200).json(new ApiResponse(true, "Holiday deleted successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
