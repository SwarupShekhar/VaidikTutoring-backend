async function sendEmail() {
    const RESEND_API_KEY = "re_QvDY5wmX_HP6GaqS9S432Eq9kV9PbKkn3";
    const toEmail = "mandshagunk@gmail.com";
    const fromEmail = "StudyHours <hellostudents@studyhours.com>";

    const emailBody = {
        to: toEmail,
        from: fromEmail,
        subject: 'Your Session Request is Confirmed! - StudyHours',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: #4F46E5;">Session Request Confirmed! 🎉</h2>
            <p>Hi Mandshagunk,</p>
            <p>We have successfully received your tutoring session request.</p>
            <p><strong>Your session is confirmed!</strong> We are currently matching you with one of our expert tutors to ensure you get the best learning experience.</p>
            <p>You will see your assigned tutor in your dashboard shortly.</p>
            <br/>
            <p>Best regards,<br/><strong>The StudyHours Team</strong></p>
          </div>
        `
    };

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + RESEND_API_KEY
            },
            body: JSON.stringify(emailBody)
        });
        const data = await response.json();
        console.log('Sent: ' + emailBody.subject + ' ->', data);
    } catch (e) {
        console.error(e);
    }
}

sendEmail();
