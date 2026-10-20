-- The WhatsApp number the organization said it will connect (digits with country code). The QR code
-- is only generated after it's informed, and a different number reading the code is disconnected.
ALTER TABLE whatsapp_config ADD COLUMN instance_number TEXT;
