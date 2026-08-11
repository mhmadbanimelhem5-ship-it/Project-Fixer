import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(to: string, subject: string, html: string) {
  const { data, error } = await resend.emails.send({
    from: 'Auryx Support <support@getauryx.com>',
    to: to,
    subject: subject,
    html: html,
  });

  if (error) {
    console.error('Resend error:', error);
    return { success: false, error };
  }
  console.log('Email sent:', data);
  return { success: true, data };
}