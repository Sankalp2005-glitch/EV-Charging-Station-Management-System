import smtplib
from email.message import EmailMessage

from config import get_smtp_settings, get_support_admin_email, get_support_from_email


def send_support_request_email(ticket):
    admin_email = get_support_admin_email()
    from_email = get_support_from_email()
    smtp_settings = get_smtp_settings()

    if not admin_email:
        return False, "Support admin email is not configured."
    if not from_email:
        return False, "Support sender email is not configured."
    if not smtp_settings["host"]:
        return False, "SMTP host is not configured."

    message = EmailMessage()
    message["Subject"] = f"[EVgo Support] {ticket['ticket_number']} | {ticket['subject']}"
    message["From"] = from_email
    message["To"] = admin_email
    if ticket.get("requester_email"):
        message["Reply-To"] = ticket["requester_email"]

    body_lines = [
        "A new EVgo support request was submitted.",
        "",
        f"Ticket number: {ticket['ticket_number']}",
        f"User role: {ticket['user_role']}",
        f"Priority: {ticket['priority']}",
        f"Category: {ticket['category']}",
        f"Status: {ticket['status']}",
        f"Subject: {ticket['subject']}",
        "",
        "Requester details",
        f"Name: {ticket['requester_name']}",
        f"Email: {ticket['requester_email']}",
        f"Phone: {ticket.get('requester_phone') or '-'}",
        "",
        "Linked references",
        f"Booking ID: {ticket.get('booking_id') or '-'}",
        f"Station ID: {ticket.get('station_id') or '-'}",
        "",
        "Issue summary",
        ticket["message"],
    ]
    message.set_content("\n".join(body_lines))

    smtp_client = smtplib.SMTP_SSL if smtp_settings["use_ssl"] else smtplib.SMTP
    with smtp_client(
        smtp_settings["host"],
        smtp_settings["port"],
        timeout=smtp_settings["timeout"],
    ) as server:
        if not smtp_settings["use_ssl"]:
            server.ehlo()
            if smtp_settings["use_tls"]:
                server.starttls()
                server.ehlo()
        if smtp_settings["username"]:
            server.login(smtp_settings["username"], smtp_settings["password"])
        server.send_message(message)

    return True, ""
