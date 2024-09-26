import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getUserIdFromRequest } from '@/lib/auth';
import User from '@/models/User';
import dbConnect from '@/lib/mongodb';

export async function POST(request: Request) {
  console.log('Payment initiation request received');

  // Connect to the database
  try {
    await dbConnect();
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Database connection failed:', error);
    return NextResponse.json(
      { error: 'Database connection failed' },
      { status: 500 }
    );
  }

  // Parse the incoming JSON payload
  const { payload } = await request.json();

  if (!payload) {
    return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
  }

  // Decode and parse the base64-encoded payload
  let decodedPayload;
  try {
    const decodedString = Buffer.from(payload, 'base64').toString('utf-8');
    decodedPayload = JSON.parse(decodedString);
  } catch (error) {
    console.error('Failed to decode payload:', error);
    return NextResponse.json(
      { error: 'Invalid payload format' },
      { status: 400 }
    );
  }

  console.log('Decoded Payload:', decodedPayload);

  // Destructure required fields from the decoded payload
  const {
    merchantId,
    merchantTransactionId,
    amount,
    mobileNumber,
    paymentInstrument,
    credits,
  } = decodedPayload;

  // Ensure all required fields are present
  if (
    !merchantId ||
    !merchantTransactionId ||
    !amount ||
    !mobileNumber ||
    !paymentInstrument
  ) {
    return NextResponse.json(
      { error: 'Missing required fields in payload' },
      { status: 400 }
    );
  }

  // Set redirectMode to 'POST' and update redirectUrl and callbackUrl
  decodedPayload.redirectMode = 'POST';
  decodedPayload.redirectUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/api/payment/callback`;
  decodedPayload.callbackUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/api/payment/callback`;

  // Re-encode the modified payload
  const modifiedPayloadString = JSON.stringify(decodedPayload);
  const modifiedPayload = Buffer.from(modifiedPayloadString).toString('base64');

  // Retrieve salt key and index from environment variables
  const saltKey = process.env.PHONEPE_SALT_KEY;
  const saltIndex = process.env.PHONEPE_SALT_INDEX;

  if (!saltKey || !saltIndex) {
    console.error('Missing PHONEPE_SALT_KEY or PHONEPE_SALT_INDEX');
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  // Calculate the checksum
  const apiEndpoint = '/pg/v1/pay';
  const dataToHash = modifiedPayload + apiEndpoint + saltKey;
  console.log('modifiedPayload:', modifiedPayload);
  console.log('apiEndpoint:', apiEndpoint);
  console.log('saltKey:', saltKey);
  console.log('saltIndex:', saltIndex);
  const calculatedChecksum =
    crypto.createHash('sha256').update(dataToHash).digest('hex') +
    '###' +
    saltIndex;

  // Get the user ID from the request
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Save the transaction in the user's document
  try {
    await User.findByIdAndUpdate(userId, {
      $push: {
        transactions: {
          transactionId: merchantTransactionId, // Ensure consistent naming
          merchantId: merchantId,
          amount: amount / 100, // Convert paise to rupees
          status: 'pending',
          credits: credits || 0, // 추가된 부분: 크레딧 수량 저장
        },
      },
    });
    console.log('Transaction saved successfully for user:', userId);
  } catch (error) {
    console.error('Error updating user transactions:', error);
    return NextResponse.json(
      { error: 'Failed to save transaction' },
      { status: 500 }
    );
  }

  console.log('Sending request to PhonePe API');

  // Send the payment initiation request to PhonePe API
  try {
    const response = await fetch(
      'https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': calculatedChecksum,
          Accept: 'application/json',
          'X-MERCHANT-ID': merchantId,
        },
        body: JSON.stringify({ request: modifiedPayload }),
      }
    );

    console.log('PhonePe API response status:', response.status);
    const data = await response.json();
    console.log('PhonePe API response data:', data);

    if (!response.ok) {
      throw new Error(
        `PhonePe API error: ${response.status} ${data.message || 'Unknown error'}`
      );
    }

    if (data.success) {
      console.log('Payment initiation successful');
      return NextResponse.json({
        url: data.data.instrumentResponse.redirectInfo.url,
      });
    } else {
      throw new Error(data.message || data.error || 'Payment initiation failed');
    }
  } catch (error) {
    console.error('Error initiating payment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}