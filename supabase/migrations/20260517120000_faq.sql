-- FAQ entries — backs the chatbot knowledge base and lets staff edit answers
-- without redeploying. Mirrors the Airtable Knowledge table.

CREATE TABLE IF NOT EXISTS public.faq (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  topic       TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  priority    INT  NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Topics seen in the existing Airtable data. Keep as a soft enum so new
-- topics can be added through the admin without a migration.
ALTER TABLE public.faq
  DROP CONSTRAINT IF EXISTS faq_topic_check,
  ADD  CONSTRAINT faq_topic_check
    CHECK (topic IS NULL OR topic IN (
      'Welcome','Hours','Location','Payment','Refund','Waitlist',
      'Pickup','Allergies','Dress Code','Escalation','Other'
    ));

CREATE INDEX IF NOT EXISTS faq_topic_idx    ON public.faq (topic);
CREATE INDEX IF NOT EXISTS faq_active_idx   ON public.faq (active);
CREATE INDEX IF NOT EXISTS faq_priority_idx ON public.faq (priority DESC);

ALTER TABLE public.faq ENABLE ROW LEVEL SECURITY;

-- The chatbot reads via the anon key; admins manage.
CREATE POLICY "public read active faq" ON public.faq
  FOR SELECT USING (active = true);
CREATE POLICY "admins manage faq" ON public.faq
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_faq_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS faq_touch ON public.faq;
CREATE TRIGGER faq_touch
  BEFORE UPDATE ON public.faq
  FOR EACH ROW EXECUTE FUNCTION public.touch_faq_updated_at();
