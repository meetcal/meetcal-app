import { Resend } from 'resend'

const resend = new Resend('re_SpdzjvPG_rspUGeK1xmqd3MhRMwimFFLR')

export async function sendFeedback({ name, email, description }: { 
  name: string
  email: string
  description: string 
}) {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 20px;
            color: #007AFF;
          }
          .section {
            margin-bottom: 20px;
          }
          .label {
            font-weight: bold;
            color: #666;
          }
          .content {
            margin-top: 8px;
          }
          .description {
            background-color: #f5f5f5;
            padding: 15px;
            border-radius: 8px;
            margin-top: 8px;
          }
        </style>
      </head>
      <body>
        <div class="header">MeetCal Feedback</div>
        
        <div class="section">
          <div class="label">From:</div>
          <div class="content">${name} (${email})</div>
        </div>
        
        <div class="section">
          <div class="label">Feedback:</div>
          <div class="description">${description}</div>
        </div>
      </body>
    </html>
  `

  const { data, error } = await resend.emails.send({
    from: 'MeetCal Feedback <feedback@wl-wargames.com>',
    to: 'memohnsen@gmail.com',
    subject: `MeetCal Feedback from ${name}`,
    html: htmlContent,
    reply_to: email
  })

  if (error) {
    throw error
  }

  return data
} 