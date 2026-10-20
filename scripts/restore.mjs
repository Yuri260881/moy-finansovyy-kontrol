// Local administrative restore into an existing Supabase account. Never run in a browser.
import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
const [file,userId]=process.argv.slice(2);
if(!file||!userId||!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore.mjs backup.json USER_UUID');
const backup=JSON.parse(await readFile(file,'utf8'));
if(backup.format!=='mfc-1')throw Error('Unsupported backup');
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const {data:target,error:authError}=await client.auth.admin.getUserById(userId);
if(authError||!target.user)throw Error('Target user does not exist');
const original=backup.records.profiles?.[0]?.id;
if(!original||original!==userId)throw Error('Backup owner differs from target user. Restore into the same account only.');
const order=['objects','categories','employees','templates','obligations','payments','payroll_accruals','receipts','user_settings','reminder_log','profiles'];
for(const table of order){const rows=backup.records[table]||[];if(!rows.length)continue;const key=table==='profiles'?'id':table==='user_settings'?'user_id':'id';const {error}=await client.from(table).upsert(rows,{onConflict:key});if(error)throw Error(`${table}: ${error.message}`);console.log(`${table}: ${rows.length}`)}
for(const row of backup.records.audit_log||[]){const {id,...entry}=row;const {error}=await client.from('audit_log').insert(entry);if(error)throw Error(`Audit: ${error.message}`)}
for(const file of backup.files||[]){const bytes=Buffer.from(file.base64,'base64');const {error}=await client.storage.from('receipts').upload(file.path,bytes,{upsert:true,contentType:file.type||'application/octet-stream'});if(error)throw Error(`Receipt ${file.path}: ${error.message}`)}
console.log('Restore complete. Reconnect Google Calendar and notification settings.');
