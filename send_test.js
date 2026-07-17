const fs = require('fs');

async function sendTestEmails() {
    const RESEND_API_KEY = "re_QvDY5wmX_HP6GaqS9S432Eq9kV9PbKkn3";
    const toEmail = "swarup.shekhar@vaidikedu.com";
    const fromEmail = "StudyHours <hellostudents@studyhours.com>";

    const emails = [
        {
            to: toEmail,
            from: fromEmail,
            subject: 'Your Session Request is Confirmed! - StudyHours',
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <h2 style="color: #4F46E5;">Session Request Confirmed! 🎉</h2>
                <p>Hi Swarup,</p>
                <p>We have successfully received your tutoring session request.</p>
                <p><strong>Your session is confirmed!</strong> We are currently matching you with one of our expert tutors to ensure you get the best learning experience.</p>
                <p>You will see your assigned tutor in your dashboard shortly.</p>
                <br/>
                <p>Best regards,<br/><strong>The StudyHours Team</strong></p>
              </div>
            `
        },
        {
            to: toEmail,
            from: fromEmail,
            subject: 'Your Tutor has been Assigned! - StudyHours',
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                    <h2 style="color: #4F46E5;">Your Tutor is Assigned! 🎉</h2>
                    <p>Hi Swarup,</p>
                    <p>Great news! We have assigned an expert tutor for your upcoming <strong>Advanced Mathematics</strong> session.</p>
                    <p><strong>Your Tutor:</strong> Sarah Johnson</p>
                    <p>You can view all the details and access the class link directly from your student dashboard.</p>
                    <br/>
                    <p>Best regards,<br/><strong>The StudyHours Team</strong></p>
                </div>
            `
        }
    ];

    for (const email of emails) {
        try {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + RESEND_API_KEY
                },
                body: JSON.stringify(email)
            });
            const data = await response.json();
            console.log('Sent: ' + email.subject + ' ->', data);
        } catch (e) {
            console.error(e);
        }
    }
}

sendTestEmails();
