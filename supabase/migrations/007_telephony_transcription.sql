-- Add transcription support to telephony_calls (durée = recording_duration_sec existant)
ALTER TABLE telephony_calls ADD COLUMN IF NOT EXISTS transcription TEXT;
