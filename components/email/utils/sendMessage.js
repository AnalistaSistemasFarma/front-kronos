export const sendMessage = async (message, emails, table, outro, logoUrl, files = []) => {
  try {
    // If files are provided, use FormData for multipart upload
    if (files && files.length > 0) {
      const formData = new FormData();

      // Add text data as individual fields
      formData.append('userEmail', emails);
      formData.append('title', message);
      formData.append('table', JSON.stringify(table)); // table is an array of objects
      formData.append('outro', outro);
      formData.append('logoUrl', logoUrl || 'https://farmalogica.com.co/imagenes/logos/logo20.png');

      // Add files
      files.forEach((file, index) => {
        formData.append('files', file);
      });

      console.log('Sending message with files:', {
        userEmail: emails,
        title: message,
        table: table,
        outro: outro,
        logoUrl: logoUrl || 'https://farmalogica.com.co/imagenes/logos/logo20.png',
        filesCount: files.length,
      });

      const res = await fetch(`${process.env.API_EMAIL}sapsend/sendMessage`, {
        method: 'POST',
        credentials: 'include',
        body: formData, // No Content-Type header needed for FormData
      });

      if (!res.ok) {
        const errorData = await res.text();
        throw new Error(`Failed to send message with files: ${res.status} ${errorData}`);
      }

      const result = await res.json();
      return result;
    } else {
      // Send as JSON for messages without files
      const requestData = {
        userEmail: emails,
        title: message,
        table: table, // table is an array of objects
        outro: outro,
        logoUrl: logoUrl || 'https://i.postimg.cc/PqPdjwzh/Logo-Amapola-Recurso-3-1.png',
      };

      console.log('Sending message without files:', requestData);

      const res = await fetch(`${process.env.API_EMAIL}sapsend/sendMessage`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      if (!res.ok) {
        const errorData = await res.text();
        throw new Error(`Failed to send message: ${res.status} ${errorData}`);
      }

      const result = await res.json();
      return result;
    }
  } catch (error) {
    console.error('Error in sendMessage:', error);
    throw error;
  }
};