import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

export const sendEmail = async (to: string, subject: string, html: string, attachments?: any[]) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || `"Enterprise HRMS" <${process.env.SMTP_EMAIL}>`,
      to,
      subject,
      html,
      attachments,
    });
    console.log('Message sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};

// =======================
// ACTION NOTIFICATIONS
// =======================

export const sendLeaveApprovalEmail = async (to: string, name: string, leaveType: string, startDate: Date, endDate: Date, status: string) => {
  const isApproved = status === 'APPROVED';
  const color = isApproved ? '#10b981' : '#ef4444';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <div style="background-color: ${color}; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">Leave Request ${status}</h2>
      </div>
      <div style="padding: 20px;">
        <p>Dear <strong>${name}</strong>,</p>
        <p>Your leave request has been <strong>${status.toLowerCase()}</strong> by HR.</p>
        <div style="background-color: #f9fafb; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Leave Type:</strong> ${leaveType}</p>
          <p style="margin: 5px 0;"><strong>Start Date:</strong> ${startDate.toLocaleDateString()}</p>
          <p style="margin: 5px 0;"><strong>End Date:</strong> ${endDate.toLocaleDateString()}</p>
        </div>
        <p>If you have any questions, please contact the HR department.</p>
        <p>Best regards,<br>Enterprise HRMS Team</p>
      </div>
    </div>
  `;
  return sendEmail(to, `Leave Request ${status} - Enterprise HRMS`, html);
};

export const sendDocumentApprovalEmail = async (to: string, name: string, documentType: string, status: string) => {
  const isApproved = status === 'APPROVED';
  const color = isApproved ? '#10b981' : '#ef4444';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <div style="background-color: ${color}; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">Document ${status}</h2>
      </div>
      <div style="padding: 20px;">
        <p>Dear <strong>${name}</strong>,</p>
        <p>Your uploaded document has been <strong>${status.toLowerCase()}</strong>.</p>
        <div style="background-color: #f9fafb; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Document Type:</strong> ${documentType}</p>
          <p style="margin: 5px 0;"><strong>Status:</strong> ${status}</p>
        </div>
        ${!isApproved ? '<p style="color: #ef4444;">Please review and re-upload a valid document if required.</p>' : ''}
        <p>Best regards,<br>Enterprise HRMS Team</p>
      </div>
    </div>
  `;
  return sendEmail(to, `Document ${status} - Enterprise HRMS`, html);
};

export const sendPayrollEmail = async (to: string, name: string, month: number, year: number, netSalary: number, bankName?: string, accountNumber?: string, pdfBuffer?: Buffer) => {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  
  const bankHtml = bankName && accountNumber 
    ? `
      <div style="margin-top: 15px; border-top: 1px solid #e5e7eb; padding-top: 15px;">
        <p style="margin: 5px 0; font-size: 14px; color: #4b5563;"><strong>Bank Name:</strong> ${bankName}</p>
        <p style="margin: 5px 0; font-size: 14px; color: #4b5563;"><strong>Account Number:</strong> ${accountNumber}</p>
      </div>
    ` 
    : '';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #3b82f6; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">Salary Credited Successfully</h2>
      </div>
      <div style="padding: 20px;">
        <p>Dear <strong>${name}</strong>,</p>
        <p>Your salary for the month of <strong>${monthNames[month - 1]} ${year}</strong> has been successfully processed and credited to your account.</p>
        <div style="background-color: #f9fafb; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 5px 0; font-size: 16px;"><strong>Net Salary:</strong> ₹${netSalary.toLocaleString()}</p>
          ${bankHtml}
        </div>
        <p>You can view your detailed payslip on the HRMS portal.</p>
        <p>Best regards,<br>Enterprise HRMS Team</p>
      </div>
    </div>
  `;

  const attachments = pdfBuffer ? [{
    filename: `Payslip_${monthNames[month - 1]}_${year}.pdf`,
    content: pdfBuffer,
    contentType: 'application/pdf'
  }] : undefined;

  return sendEmail(to, `Salary Credited: ${monthNames[month - 1]} ${year} - Enterprise HRMS`, html, attachments);
};
