# Standards Scraper

This scraper automatically fetches and updates USA Weightlifting standards from the official selection procedures page.

## Setup

1. Create a virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create a `.env` file in the `standards_scraper` directory with:
```
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```

## Usage

### Dry Run (Preview Changes)

Preview what would be inserted/updated without making database changes:

```bash
source venv/bin/activate
python scraper.py --dry-run
```

### Full Run (Update Database)

Update the Supabase database with the latest standards:

```bash
source venv/bin/activate
python scraper.py
```

## How It Works

1. Fetches the selection procedures page: https://www.usaweightlifting.org/resources/athlete-information-and-programs/selection-procedures
2. Finds the PDF link containing "Standards" in the text
3. Downloads and parses the PDF to extract:
   - Age categories: Senior, Junior, Youth, U15
   - Genders: Men, Women
   - Weight classes: e.g., 48, 53, 58, 60, 65, etc.
   - A Standards: Higher qualifying totals
   - B Standards: Lower qualifying totals
4. Upserts to Supabase table `standards` matching on:
   - `age_category`
   - `gender`
   - `weight_class`

## Database Schema

The scraper expects a table with the following structure:

```sql
create table public.standards (
  id serial not null,
  age_category text not null,
  gender text not null,
  weight_class text not null,
  standard_a integer not null,
  standard_b integer not null default 0,
  created_at timestamp with time zone null default now(),
  constraint standards_pkey primary key (id)
);
```

