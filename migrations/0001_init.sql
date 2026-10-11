-- Life in the UK revision app: initial schema.
-- Layers are kept separate on purpose:
--   source content   -> import_batches, questions (with an immutable `original` snapshot)
--   categorisation   -> categories, question_categories, questions.topics
--   practice history -> practice_sessions, attempts
--   scheduling       -> review_states
--   data quality     -> question_flags

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE mock_exams (
  number      integer PRIMARY KEY CHECK (number BETWEEN 1 AND 200),
  title       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename      text NOT NULL,
  file_hash     text NOT NULL,              -- sha256 of the uploaded bytes
  source_format text NOT NULL CHECK (source_format IN ('docx','markdown','text','manual','backup')),
  label         text,
  interpretation jsonb NOT NULL DEFAULT '{}'::jsonb, -- how the document was read (marker style, exam assignment)
  stats         jsonb NOT NULL DEFAULT '{}'::jsonb, -- imported / skipped / duplicate / flagged counts
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_batches_file_hash_idx ON import_batches (file_hash);

CREATE TABLE questions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         uuid REFERENCES import_batches(id) ON DELETE SET NULL,
  mock_exam_number integer REFERENCES mock_exams(number) ON DELETE SET NULL,
  question_number  integer CHECK (question_number IS NULL OR question_number > 0),
  source_position  integer,                 -- order within the source document
  prompt           text NOT NULL CHECK (length(prompt) > 0),
  question_type    text NOT NULL CHECK (question_type IN ('single','multi','true_false')),
  options          jsonb NOT NULL,          -- [{ "key": "A", "text": "..." }]
  correct_keys     text[] NOT NULL CHECK (cardinality(correct_keys) > 0),
  explanation      text,
  source_result    text CHECK (source_result IN ('correct','incorrect')), -- result recorded in the Word document
  original         jsonb,                   -- untouched snapshot of the imported record
  content_hash     text NOT NULL,           -- normalised prompt + options, used for duplicate detection
  topics           text[] NOT NULL DEFAULT '{}',
  notes            text,
  memory_aid       text,
  is_important     boolean NOT NULL DEFAULT false,
  is_confusing     boolean NOT NULL DEFAULT false,
  edited_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX questions_content_hash_key ON questions (content_hash);
CREATE INDEX questions_mock_idx ON questions (mock_exam_number, question_number);
CREATE INDEX questions_batch_idx ON questions (batch_id);
CREATE INDEX questions_topics_idx ON questions USING gin (topics);

CREATE TABLE categories (
  id          serial PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 100
);

CREATE TABLE question_categories (
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  category_id integer NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  source      text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
  PRIMARY KEY (question_id, category_id)
);
CREATE INDEX question_categories_category_idx ON question_categories (category_id);

CREATE TABLE practice_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode         text NOT NULL,
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  question_ids uuid[] NOT NULL DEFAULT '{}',
  time_limit_seconds integer,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX practice_sessions_started_idx ON practice_sessions (started_at DESC);

CREATE TABLE attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id   uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  session_id    uuid REFERENCES practice_sessions(id) ON DELETE SET NULL,
  mode          text NOT NULL,
  selected_keys text[] NOT NULL DEFAULT '{}',
  is_correct    boolean NOT NULL,
  confidence    smallint CHECK (confidence BETWEEN 1 AND 3), -- 1 guess, 2 unsure, 3 sure
  self_marked   boolean NOT NULL DEFAULT false,              -- marked by the learner rather than auto-checked
  response_ms   integer CHECK (response_ms IS NULL OR response_ms >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attempts_question_idx ON attempts (question_id, created_at DESC);
CREATE INDEX attempts_session_idx ON attempts (session_id);
CREATE INDEX attempts_created_idx ON attempts (created_at DESC);

CREATE TABLE review_states (
  question_id      uuid PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  ease             real NOT NULL DEFAULT 2.5,
  interval_days    real NOT NULL DEFAULT 0,
  due_at           timestamptz,
  reps             integer NOT NULL DEFAULT 0,
  lapses           integer NOT NULL DEFAULT 0,
  correct_streak   integer NOT NULL DEFAULT 0,
  last_result      boolean,
  last_confidence  smallint,
  last_reviewed_at timestamptz,
  last_correct_at  timestamptz,
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new','learning','needs_revision','mastered')),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_states_due_idx ON review_states (due_at);
CREATE INDEX review_states_status_idx ON review_states (status);

CREATE TABLE question_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  reason      text NOT NULL CHECK (reason IN ('confusing','possible_error','duplicate','other')),
  note        text,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX question_flags_open_idx ON question_flags (question_id) WHERE resolved_at IS NULL;

INSERT INTO categories (slug, name, description, sort_order) VALUES
  ('dates',      'Years & dates',              'Years, historical dates, calendar dates and periods', 10),
  ('numbers',    'Numbers & statistics',       'Quantities, ages, percentages, money and other figures', 20),
  ('people',     'People & names',             'Important people, their roles and achievements', 30),
  ('monarchy',   'Kings, queens & royalty',    'Monarchs, reigns and royal history', 40),
  ('history',    'History & events',           'Historical events, periods and timelines', 50),
  ('government', 'Government & politics',      'Parliament, elections, the constitution and international bodies', 60),
  ('geography',  'Geography & places',         'Countries, cities, capitals, landmarks and locations', 70),
  ('law',        'Law, rights & citizenship',  'Courts, the law, rights, responsibilities and everyday rules', 80),
  ('culture',    'Culture, arts & sport',      'Traditions, literature, music, film, food and sport', 90),
  ('religion',   'Religion & festivals',       'Churches, faiths, festivals and special days', 100),
  ('science',    'Science & inventions',       'Scientists, inventors and discoveries', 110),
  ('values',     'Values & society',           'Fundamental principles, charities and community life', 120),
  ('uncategorised', 'Uncategorised',           'No rule matched yet; assign a category manually', 999);

INSERT INTO mock_exams (number, title)
SELECT n, 'Mock test ' || n FROM generate_series(1, 40) AS n;

-- Per-question practice summary used by lists, filters and analytics.
CREATE VIEW question_attempt_stats AS
SELECT q.id AS question_id,
       count(a.id)::int                                   AS attempts,
       (count(a.id) FILTER (WHERE NOT a.is_correct))::int AS wrong,
       max(a.created_at)                                  AS last_attempt_at,
       (array_agg(a.is_correct ORDER BY a.created_at))[1] AS first_attempt_correct
FROM questions q
LEFT JOIN attempts a ON a.question_id = q.id
GROUP BY q.id;
