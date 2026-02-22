#!/bin/bash
cd /Users/maddisenmohnsen/Desktop/meetcal
export SCRAPER_SECRET="24867d854eb4f5677cb12a0d4bc8b9ddafe4957c3d11de7930b6a7e5eba9c9f8"
python3 migration/import_all.py --table lifting_results > /tmp/migration_lifting2.log 2>&1
