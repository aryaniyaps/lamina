import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const from = process.env.EMAIL_FROM ?? "HavenStay <noreply@havenstay.com>";

async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  if (!resend) {
    console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
    console.log(html);
    return { id: "console" };
  }

  return resend.emails.send({ from, to, subject, html });
}

export async function sendBookingConfirmation({
  to,
  guestName,
  hotelName,
  confirmationCode,
  checkIn,
  checkOut,
  total,
}: {
  to: string;
  guestName: string;
  hotelName: string;
  confirmationCode: string;
  checkIn: string;
  checkOut: string;
  total: string;
}) {
  return sendEmail({
    to,
    subject: `Booking confirmed — ${hotelName}`,
    html: `
      <h1>Your stay is confirmed</h1>
      <p>Hi ${guestName},</p>
      <p>Your reservation at <strong>${hotelName}</strong> is confirmed.</p>
      <p><strong>Confirmation:</strong> ${confirmationCode}</p>
      <p><strong>Check-in:</strong> ${checkIn}</p>
      <p><strong>Check-out:</strong> ${checkOut}</p>
      <p><strong>Total:</strong> ${total}</p>
      <p>View your trip in HavenStay anytime.</p>
    `,
  });
}

export async function sendBookingCancellation({
  to,
  guestName,
  hotelName,
  confirmationCode,
  refundAmount,
}: {
  to: string;
  guestName: string;
  hotelName: string;
  confirmationCode: string;
  refundAmount: string;
}) {
  return sendEmail({
    to,
    subject: `Booking cancelled — ${hotelName}`,
    html: `
      <h1>Booking cancelled</h1>
      <p>Hi ${guestName},</p>
      <p>Your reservation (${confirmationCode}) at ${hotelName} has been cancelled.</p>
      <p><strong>Refund:</strong> ${refundAmount}</p>
    `,
  });
}

export async function sendNewMessageNotification({
  to,
  recipientName,
  hotelName,
  preview,
}: {
  to: string;
  recipientName: string;
  hotelName: string;
  preview: string;
}) {
  return sendEmail({
    to,
    subject: `New message about your stay at ${hotelName}`,
    html: `
      <h1>New message</h1>
      <p>Hi ${recipientName},</p>
      <p>You have a new message regarding your stay at ${hotelName}:</p>
      <blockquote>${preview}</blockquote>
    `,
  });
}

export async function sendReviewRequest({
  to,
  guestName,
  hotelName,
}: {
  to: string;
  guestName: string;
  hotelName: string;
}) {
  return sendEmail({
    to,
    subject: `How was your stay at ${hotelName}?`,
    html: `
      <h1>Share your experience</h1>
      <p>Hi ${guestName},</p>
      <p>We hope you enjoyed your stay at ${hotelName}. Please take a moment to leave a review.</p>
    `,
  });
}
