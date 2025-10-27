import * as https from 'https';
import { NextRequest, NextResponse } from 'next/server';

interface SapLoginRequest {
  companyId: number;
  endpoint: string;
  username: string;
  password: string;
  client?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { companyId, endpoint, username, password, client }: SapLoginRequest =
      await request.json();

    if (!companyId || !endpoint || !username || !password) {
      return NextResponse.json(
        { error: 'Missing required fields: companyId, endpoint, username, password' },
        { status: 400 }
      );
    }

    const loginUrl = `${endpoint}/b1s/v1/Login`;

    const loginPayload = {
      UserName: username,
      Password: password,
      CompanyDB: client || 'SBO_KRONOS', // Default client if not provided
    };

    console.log('SAP Login URL:', loginPayload);
    console.log('SAP Login URL:', loginUrl);
    console.log('Attempting fetch with rejectUnauthorized: false');

    let response;
    try {
      response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(loginPayload),
        // Disable SSL verification for self-signed certificates
        // @ts-expect-error - Node.js fetch with agent
        agent: new https.Agent({
          rejectUnauthorized: false,
          // Additional SSL options for debugging
          checkServerIdentity: (host, cert) => {
            console.log('Certificate subject:', cert.subject);
            console.log('Certificate issuer:', cert.issuer);
            console.log('Certificate valid from:', cert.valid_from);
            console.log('Certificate valid to:', cert.valid_to);
            console.log('Certificate fingerprint:', cert.fingerprint);
            return undefined; // Allow the connection
          },
        }),
      });
      console.log('Fetch successful, response status:', response.status);
    } catch (fetchError) {
      console.error('Fetch failed with error:', fetchError);
      if (fetchError instanceof Error) {
        console.error('Error message:', fetchError.message);
        // Check if it's a Node.js error with code
        if ('code' in fetchError) {
          console.error('Error code:', fetchError.code);
        }
      }
      throw fetchError; // Re-throw to be caught by outer catch
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('SAP Login failed:', errorText);
      return NextResponse.json(
        { error: 'SAP authentication failed', details: errorText },
        { status: response.status }
      );
    }

    const loginData = await response.json();
    const sessionId = loginData.SessionId;

    if (!sessionId) {
      return NextResponse.json({ error: 'No session ID received from SAP' }, { status: 500 });
    }

    // Calculate expiration (SAP sessions typically last 30 minutes)
    const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes from now

    return NextResponse.json({
      companyId,
      token: sessionId,
      expiresAt,
      endpoint,
    });
  } catch (error) {
    console.error('Error in SAP authentication:', error);
    return NextResponse.json(
      { error: 'Internal server error during SAP authentication' },
      { status: 500 }
    );
  }
}
