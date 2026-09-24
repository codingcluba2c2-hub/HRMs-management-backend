import puppeteer from 'puppeteer';

interface PayslipData {
  companyName: string;
  companyAddress: string;
  companyWebsite: string;
  companyPhone: string;
  month: number;
  year: number;
  employeeName: string;
  employeeId: string;
  employeeEmail: string;
  paymentDate: Date;
  workingDays: number;
  transactionId: string;
  bankName: string;
  accountNumber: string;
  basicSalary: number;
  bonus: number;
  deductions: number;
  netSalary: number;
}

export const generatePayslipPdf = async (data: PayslipData): Promise<Buffer> => {
  const {
    companyName, companyAddress, companyWebsite, companyPhone,
    month, year, employeeName, employeeId, employeeEmail,
    paymentDate, workingDays, transactionId, bankName, accountNumber,
    basicSalary, bonus, deductions, netSalary
  } = data;

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          color: #333;
          background-color: #fff;
          margin: 0;
          padding: 40px;
        }
        .header {
          display: flex;
          justify-content: space-between;
          border-bottom: 2px solid #f0f0f0;
          padding-bottom: 20px;
          margin-bottom: 30px;
        }
        .company-info h1 {
          color: #2563eb;
          margin: 0 0 10px 0;
          font-size: 24px;
        }
        .company-info p {
          margin: 3px 0;
          color: #6b7280;
          font-size: 12px;
        }
        .payslip-title {
          text-align: right;
        }
        .payslip-title h2 {
          margin: 0 0 5px 0;
          font-size: 20px;
          letter-spacing: 1px;
        }
        .payslip-title p {
          margin: 0;
          font-size: 12px;
          color: #374151;
        }
        .section-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 30px;
        }
        .section {
          width: 48%;
        }
        .section-title {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 15px;
          padding-bottom: 5px;
          border-bottom: 1px solid #e5e7eb;
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
          font-size: 13px;
        }
        .info-label {
          color: #6b7280;
        }
        .info-value {
          font-weight: 500;
          text-align: right;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 30px;
          font-size: 13px;
        }
        th, td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid #e5e7eb;
        }
        th {
          background-color: #f9fafb;
          color: #4b5563;
          font-weight: 600;
        }
        td.amount {
          text-align: right;
        }
        .total-row {
          font-weight: bold;
          background-color: #f9fafb;
        }
        .deduction {
          color: #ef4444;
        }
        .net-pay {
          background-color: #ecfdf5;
          border: 1px solid #a7f3d0;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          margin-bottom: 40px;
        }
        .net-pay h3 {
          margin: 0;
          color: #065f46;
          font-size: 18px;
        }
        .net-pay .amount {
          font-size: 24px;
          font-weight: bold;
          color: #10b981;
        }
        .footer {
          text-align: center;
          color: #9ca3af;
          font-size: 11px;
          border-top: 1px solid #e5e7eb;
          padding-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="company-info">
          <h1>${companyName || 'Enterprise HRMS'}</h1>
          <p>${companyAddress || 'Corporate Office'}</p>
          <p>${companyWebsite || ''} ${companyPhone ? '| ' + companyPhone : ''}</p>
        </div>
        <div class="payslip-title">
          <h2>PAYSLIP</h2>
          <p><strong>For the Month of:</strong><br>${month}/${year}</p>
        </div>
      </div>

      <div class="section-row">
        <div class="section">
          <div class="section-title">Employee Summary</div>
          <div class="info-row">
            <span class="info-label">Employee Name:</span>
            <span class="info-value">${employeeName}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Employee ID:</span>
            <span class="info-value">${employeeId}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Email:</span>
            <span class="info-value">${employeeEmail}</span>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Payment Details</div>
          <div class="info-row">
            <span class="info-label">Payment Date:</span>
            <span class="info-value">${new Date(paymentDate).toLocaleDateString()}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Working Days:</span>
            <span class="info-value">${workingDays}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Transaction ID:</span>
            <span class="info-value">${transactionId || 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Bank Name:</span>
            <span class="info-value">${bankName || 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Account No:</span>
            <span class="info-value">${accountNumber || 'N/A'}</span>
          </div>
        </div>
      </div>

      <div class="section-row" style="margin-bottom: 10px;">
        <div class="section" style="width: 49%;">
          <table>
            <thead>
              <tr>
                <th>Earnings</th>
                <th class="amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Basic Salary</td>
                <td class="amount">₹${Number(basicSalary).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Bonus / Allowance</td>
                <td class="amount">₹${Number(bonus).toFixed(2)}</td>
              </tr>
              <tr class="total-row">
                <td>Total Earnings</td>
                <td class="amount">₹${(Number(basicSalary) + Number(bonus)).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div class="section" style="width: 49%;">
          <table>
            <thead>
              <tr>
                <th>Deductions</th>
                <th class="amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Tax / Deductions</td>
                <td class="amount deduction">-₹${Number(deductions).toFixed(2)}</td>
              </tr>
              <tr>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
              <tr class="total-row">
                <td>Total Deductions</td>
                <td class="amount deduction">-₹${Number(deductions).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="net-pay">
        <h3>Net Payable Salary: <span class="amount">₹${Number(netSalary).toFixed(2)}</span></h3>
      </div>

      <div class="footer">
        This is a computer-generated document. No signature is required.
      </div>
    </body>
    </html>
  `;

  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  const page = await browser.newPage();
  
  await page.setContent(htmlContent, { waitUntil: 'load' });
  
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: {
      top: '20px',
      right: '20px',
      bottom: '20px',
      left: '20px'
    }
  });

  await browser.close();

  return Buffer.from(pdfBuffer);
};
