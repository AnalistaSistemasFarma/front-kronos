export const sendMessage = async (message, emails, table, outro, logoUrl, files = []) => {
  try {
    // El envío pasa por /api/email/send (proxy server-side → API_EMAIL en .env).
    if (files && files.length > 0) {
      console.warn(
        'sendMessage: el envío de adjuntos por correo no está soportado por el proxy; se enviará sin archivos.'
      );
    }

    const requestData = {
      userEmail: emails,
      title: message,
      table,
      outro,
      logoUrl: logoUrl || 'https://farmalogica.com.co/imagenes/logos/logo20.png',
    };

    const res = await fetch('/api/email/send', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!res.ok) {
      const errorData = await res.text();
      throw new Error(`Failed to send message: ${res.status} ${errorData}`);
    }

    return await res.json();
  } catch (error) {
    console.error('Error in sendMessage:', error);
    throw error;
  }
};
