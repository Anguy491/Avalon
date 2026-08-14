const schema = 'avalon_runtime';

exports.up = (pgm) => {
  pgm.addColumns(
    { schema, name: 'rooms' },
    {
      recovery_started_at: { type: 'timestamptz' },
      recovery_expires_at: { type: 'timestamptz' },
    },
  );
  pgm.createIndex({ schema, name: 'rooms' }, ['recovery_expires_at'], {
    name: 'rooms_recovery_expires_at_idx',
    where: 'recovery_expires_at is not null',
  });
  pgm.addColumns(
    { schema, name: 'outbox' },
    { live_audio_cue_id: { type: 'varchar(80)' } },
  );
};

exports.down = (pgm) => {
  pgm.dropColumn({ schema, name: 'outbox' }, 'live_audio_cue_id');
  pgm.dropIndex({ schema, name: 'rooms' }, ['recovery_expires_at'], {
    name: 'rooms_recovery_expires_at_idx',
  });
  pgm.dropColumns({ schema, name: 'rooms' }, [
    'recovery_started_at',
    'recovery_expires_at',
  ]);
};
