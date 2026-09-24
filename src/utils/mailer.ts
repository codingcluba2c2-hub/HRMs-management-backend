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
  
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 650px; margin: 0 auto; background-color: #f4f5f7; padding: 40px 20px;">
      <div style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        
        <!-- Header -->
        <div style="background-color: #002b5e; padding: 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: 1px;">ENTERPRISE HRMS</h1>
          <p style="color: #9baec4; margin: 5px 0 0; font-size: 13px; letter-spacing: 2px;">PAYROLL & COMPENSATION</p>
        </div>

        <!-- Body -->
        <div style="padding: 40px 30px;">
          <h2 style="color: #002b5e; margin: 0 0 20px; font-size: 22px; font-weight: 600;">Salary Disbursement Completed</h2>
          
          <div style="background-color: #fdf2f2; border-left: 4px solid #d9534f; padding: 20px; margin-bottom: 30px; border-radius: 4px;">
            <h3 style="margin: 0 0 8px; color: #333333; font-size: 15px; font-weight: 600; text-transform: uppercase;">Action Taken</h3>
            <p style="margin: 0; color: #555555; font-size: 14px; line-height: 1.5;">Your salary for the month of <strong>${monthNames[month - 1]} ${year}</strong> has been successfully processed and disbursed. The detailed payslip is attached.</p>
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 30px;">
            <tbody>
              <tr>
                <td style="padding: 14px 0; color: #666666; border-bottom: 1px solid #eeeeee;">Employee Name</td>
                <td style="padding: 14px 0; color: #111111; border-bottom: 1px solid #eeeeee; font-weight: 600; text-align: right;">${name}</td>
              </tr>
              <tr>
                <td style="padding: 14px 0; color: #666666; border-bottom: 1px solid #eeeeee;">Pay Period</td>
                <td style="padding: 14px 0; color: #111111; border-bottom: 1px solid #eeeeee; font-weight: 600; text-align: right;">${monthNames[month - 1]} ${year}</td>
              </tr>
              <tr>
                <td style="padding: 14px 0; color: #666666; border-bottom: 1px solid #eeeeee;">Net Salary</td>
                <td style="padding: 14px 0; color: #111111; border-bottom: 1px solid #eeeeee; font-weight: 600; text-align: right;">₹${netSalary.toLocaleString()}</td>
              </tr>
              <tr>
                <td style="padding: 14px 0; color: #666666; border-bottom: 1px solid #eeeeee;">Status</td>
                <td style="padding: 14px 0; color: #111111; border-bottom: 1px solid #eeeeee; font-weight: 600; text-align: right;">CREDITED</td>
              </tr>
              ${bankName ? `
              <tr>
                <td style="padding: 14px 0; color: #666666; border-bottom: 1px solid #eeeeee;">Bank Name</td>
                <td style="padding: 14px 0; color: #111111; border-bottom: 1px solid #eeeeee; font-weight: 600; text-align: right;">${bankName}</td>
              </tr>
              ` : ''}
              ${accountNumber ? `
              <tr>
                <td style="padding: 14px 0; color: #666666; border-bottom: 1px solid #eeeeee;">Account Number</td>
                <td style="padding: 14px 0; color: #111111; border-bottom: 1px solid #eeeeee; font-weight: 600; text-align: right;">${accountNumber}</td>
              </tr>
              ` : ''}
            </tbody>
          </table>

          <p style="text-align: center; color: #666666; font-size: 13px; margin: 0;">
            Need assistance? Contact <a href="mailto:hr-support@company.com" style="color: #002b5e; text-decoration: none; font-weight: 600;">hr-support@company.com</a>
          </p>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #000000; padding: 30px; text-align: center;">
          <p style="color: #ffffff; margin: 0 0 10px; font-size: 14px; font-weight: 600;">Powered By HRMS Pro</p>
          <p style="color: #aaaaaa; margin: 0 0 15px; font-size: 12px;">Empowering business with intelligent automation</p>
          <p style="color: #777777; margin: 0; font-size: 11px;">&copy; ${year} Enterprise HRMS. All rights reserved.</p>
        </div>
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
