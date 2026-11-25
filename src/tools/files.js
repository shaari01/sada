import { newClip, newTrack, getTrack, trackEnd, newProject } from '../core/project.js';
import { uid } from '../core/ids.js';
import { pcmDuration, ensureChannels } from '../core/pcm.js';
import { progressDlg, toast } from '../ui/dom.js';
import { audioCtx } from '../audio/engine.js';

export async function importFiles(app, files, { newTrack: forceNew = false, at = null } = {}) {
  files = [...files].filter(Boolean); if (!files.length) return [];
  const pg = progressDlg('فتح الملفات'); const ids = [];
  try {
    for (const [i, f] of files.entries()) {
      pg.set(null, `جارٍ قراءة «${f.name}» (${i + 1}/${files.length})…`);
      let pcm;
      try { pcm = await app.decodeFile(f); } catch (e) { toast(`تعذّر فتح «${f.name}»: صيغة غير مدعومة`, 'error', 5000); continue; }
      if (pcm.channels.length > 2) pcm = { sampleRate: pcm.sampleRate, channels: pcm.channels.slice(0, 2) };
      const id = app.addSource(uid('src'), pcm, { name: f.name });
      const dur = pcmDuration(pcm); const name = f.name.replace(/\.[^.]+$/, '');
      ids.push(id);
      app.commit(`فتح ${name}`, (p) => {
        if (!p.sampleRate || p.tracks.every((t) => !t.clips.length)) p.sampleRate = audioCtx().sampleRate;
        let tr = getTrack(p, p.activeTrackId);
        const empty = p.tracks.length === 1 && !tr.clips.length;
        if (empty && (p.name === 'مشروع جديد' || !p.name)) p.name = name;
        if (!empty && (forceNew || i > 0 || tr.clips.length)) { tr = newTrack(p.tracks.length, name); p.tracks.push(tr); }
        else if (empty) tr.name = name;
        const start = at ?? (tr.clips.length ? trackEnd(tr) : 0);
        tr.clips.push(newClip(id, dur, start, 0));
        p.activeTrackId = tr.id;
      });
    }
  } finally { pg.close(); }
  return ids;
}
export { ensureChannels, newProject };
