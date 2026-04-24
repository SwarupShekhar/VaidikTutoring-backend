import psycopg2
import os

url = "postgresql://neondb_owner:npg_iLS6EqazVd5e@ep-super-feather-ahnp7ryx.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require"
try:
    conn = psycopg2.connect(url)
    print("Connection successful!")
    cur = conn.cursor()
    cur.execute("SELECT 1")
    print("Result:", cur.fetchone())
    conn.close()
except Exception as e:
    print("Connection failed:", e)
