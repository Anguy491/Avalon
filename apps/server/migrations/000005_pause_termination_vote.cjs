const schema = 'avalon_runtime';

exports.up = (pgm) => {
  pgm.addColumns(
    { schema, name: 'rooms' },
    { pause_vote_expires_at: { type: 'timestamptz' } },
  );
  pgm.createIndex({ schema, name: 'rooms' }, ['pause_vote_expires_at'], {
    name: 'rooms_pause_vote_expires_at_idx',
    where: 'pause_vote_expires_at is not null',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex({ schema, name: 'rooms' }, ['pause_vote_expires_at'], {
    name: 'rooms_pause_vote_expires_at_idx',
  });
  pgm.dropColumn({ schema, name: 'rooms' }, 'pause_vote_expires_at');
};
