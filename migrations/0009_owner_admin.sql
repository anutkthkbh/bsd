-- New platform owner admin: sign-in is by verified email code, Google or verified SMS.
-- An existing admin keeps its established credentials; only non-admin accounts are promoted below.
-- An existing non-admin account with this email is promoted and its earlier credentials are revoked.
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='shmuelilani14789@gmail.com' AND role<>'admin');
DELETE FROM auth_identities WHERE user_id IN (SELECT id FROM users WHERE email='shmuelilani14789@gmail.com' AND role<>'admin');
UPDATE customer_profiles SET phone='',email_verified=0,phone_verified=0
  WHERE user_id IN (SELECT id FROM users WHERE email='shmuelilani14789@gmail.com' AND role<>'admin');
UPDATE users SET role='admin',store_id=NULL,password_salt='',password_hash=''
  WHERE email='shmuelilani14789@gmail.com' AND role<>'admin';
INSERT INTO users(id,email,name,role,store_id,password_salt,password_hash)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  'shmuelilani14789@gmail.com','מנהל המערכת','admin',NULL,'',''
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email='shmuelilani14789@gmail.com');
