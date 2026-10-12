// Application backups. The legacy import/migration tooling was retired with the
// Lifegroup tracker; backups now export only the tables the site still uses.
import { transaction, databaseBackup } from './db.js';
export const exportBackup=()=>transaction(client=>databaseBackup(client),{write:false});
