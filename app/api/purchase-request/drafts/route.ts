import * as https from 'https';
import { NextRequest, NextResponse } from 'next/server';

interface DraftRequest {
  companyId: number;
  endpoint: string;
  token: string;
}

interface SapDraft {
  DocEntry: number;
  DocNum: number;
  DocDate: string;
  DocDueDate: string;
  CardCode: string;
  CardName: string;
  DocTotal: number;
  Comments?: string;
  // Add other relevant fields as needed
}

export async function POST(request: NextRequest) {
  try {
    const { companyId, endpoint, token }: DraftRequest = await request.json();

    if (!companyId || !endpoint || !token) {
      return NextResponse.json(
        { error: 'Missing required fields: companyId, endpoint, token' },
        { status: 400 }
      );
    }

    const draftsUrl = `${endpoint}/b1s/v1/Drafts`;

    const response = await fetch(draftsUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `B1SESSION=${token}`,
      },
      // @ts-expect-error - Node.js fetch with agent
      agent: new https.Agent({
        rejectUnauthorized: false,
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        return NextResponse.json({ error: 'Token expired or invalid', companyId }, { status: 401 });
      }
      const errorText = await response.text();
      console.error('SAP Drafts fetch failed:', errorText);
      return NextResponse.json(
        { error: 'Failed to fetch drafts', details: errorText, companyId },
        { status: response.status }
      );
    }

    const draftsData = await response.json();
    const drafts: SapDraft[] = draftsData.value || [];

    // Filter only purchase request drafts (ObjectCode = 22 for Purchase Requests)
    const purchaseRequestDrafts = drafts.filter(
      (draft: SapDraft & { ObjectCode?: number }) => draft.ObjectCode === 22
    );

    return NextResponse.json({
      companyId,
      drafts: purchaseRequestDrafts,
    });
  } catch (error) {
    console.error('Error fetching SAP drafts:', error);
    return NextResponse.json(
      { error: 'Internal server error while fetching drafts' },
      { status: 500 }
    );
  }
}
