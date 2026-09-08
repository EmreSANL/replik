import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable('rooms', {
  code: text('code').primaryKey(),
  scene: integer('scene').notNull(),
  status: text('status').notNull().default('lobby'),
  createdAt: integer('created_at').notNull(),
  playAt: integer('play_at').notNull().default(0),
});
export const players = sqliteTable(
  'players',
  {
    id: text('id').primaryKey(),
    room: text('room')
      .notNull()
      .references(() => rooms.code),
    token: text('token').notNull(),
    name: text('name').notNull(),
    host: integer('host').notNull().default(0),
    role: integer('role').notNull().default(-1),
    ready: integer('ready').notNull().default(0),
    audio: text('audio'),
    joinedAt: integer('joined_at').notNull(),
  },
  (t) => [index('idx_players_room').on(t.room)],
);
