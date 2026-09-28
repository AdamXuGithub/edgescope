-- Run the collector every 5 minutes. Replace <project-ref> and <anon-key> (the public anon key).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('es-collect-every-5min', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/es-collect',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <anon-key>'),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
