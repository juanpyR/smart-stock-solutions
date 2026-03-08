-- ═══════════════════════════════════════════════════════════════
-- SCRIPT DE SEGURIDAD — Smart Stock Solutions
-- Ejecutar como superusuario de PostgreSQL
-- ═══════════════════════════════════════════════════════════════

-- 1. Cambiar contraseña del usuario de la aplicación
ALTER USER juan_admin WITH PASSWORD '<TU_CONTRASEÑA_AQUÍ>';

-- 2. Revocar permisos innecesarios (principio de mínimo privilegio)
REVOKE ALL ON DATABASE inventory_db FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- 3. Juan_admin solo puede operar en su base de datos (no puede crear DBs ni roles)
ALTER USER juan_admin NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

-- 4. Asegurar que juan_admin tiene los permisos mínimos necesarios
GRANT CONNECT ON DATABASE inventory_db TO juan_admin;
GRANT USAGE ON SCHEMA public TO juan_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO juan_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO juan_admin;

-- 5. Configurar timeout para conexiones inactivas (anti denegación de servicio)
ALTER USER juan_admin CONNECTION LIMIT 20;

-- 6. Verificar configuración resultante
SELECT usename, usecreatedb, usecreaterole, usesuper, connlimit
FROM pg_user WHERE usename = 'juan_admin';
