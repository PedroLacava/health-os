alter table metrics
  add column if not exists provenance text not null default 'measured'
    check (provenance in ('measured','estimated','self_reported','inferred')),
  add column if not exists confidence double precision
    check (confidence is null or (confidence >= 0 and confidence <= 1));

create table if not exists hydration_events (
  id uuid primary key default gen_random_uuid(),
  recorded_at timestamptz not null default now(),
  volume_ml integer not null check (volume_ml > 0 and volume_ml <= 5000),
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create table if not exists daily_checkins (
  id uuid primary key default gen_random_uuid(),
  recorded_at timestamptz not null default now(),
  energy smallint check (energy between 1 and 5),
  concentration smallint check (concentration between 1 and 5),
  stress smallint check (stress between 1 and 5),
  hunger smallint check (hunger between 1 and 5),
  physical_fatigue smallint check (physical_fatigue between 1 and 5),
  wellbeing smallint check (wellbeing between 1 and 5),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists work_context (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  workload smallint check (workload between 1 and 5),
  pressure smallint check (pressure between 1 and 5),
  interruptions smallint check (interruptions between 1 and 5),
  sense_of_control smallint check (sense_of_control between 1 and 5),
  meeting_minutes integer check (meeting_minutes is null or meeting_minutes >= 0),
  tags text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(work_date)
);

create table if not exists meals (
  id uuid primary key default gen_random_uuid(),
  eaten_at timestamptz not null default now(),
  photo_url text,
  description text,
  foods jsonb not null default '[]',
  energy_kcal double precision check (energy_kcal is null or energy_kcal >= 0),
  protein_g double precision check (protein_g is null or protein_g >= 0),
  carbs_g double precision check (carbs_g is null or carbs_g >= 0),
  fat_g double precision check (fat_g is null or fat_g >= 0),
  fiber_g double precision check (fiber_g is null or fiber_g >= 0),
  confidence double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists clinical_measurements (
  id uuid primary key default gen_random_uuid(),
  measured_at timestamptz not null,
  panel text,
  marker text not null,
  value_num double precision,
  value_text text,
  unit text,
  reference_low double precision,
  reference_high double precision,
  source_document text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (value_num is not null or value_text is not null)
);

create index if not exists hydration_events_recorded_at_idx on hydration_events(recorded_at desc);
create index if not exists daily_checkins_recorded_at_idx on daily_checkins(recorded_at desc);
create index if not exists work_context_work_date_idx on work_context(work_date desc);
create index if not exists meals_eaten_at_idx on meals(eaten_at desc);
create index if not exists clinical_measurements_marker_measured_at_idx on clinical_measurements(marker, measured_at desc);

alter table hydration_events enable row level security;
alter table daily_checkins enable row level security;
alter table work_context enable row level security;
alter table meals enable row level security;
alter table clinical_measurements enable row level security;
