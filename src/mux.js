// מיזוג קובצי DASH של יוטיוב (MP4 מפוצל) לקובץ MP4 אחד – בלי ffmpeg.
// כל קלט הוא קובץ שלם עם moov אחד ורצף של moof+mdat. הפלט: moov משותף
// שבו כל track מקבל מזהה משלו, והמקטעים משתלבים לפי זמן.
const Mux = (() => {
  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const w32 = (b, o, v) => {
    b[o] = v >>> 24; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255;
  };
  const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0));
  const fail = () => { throw new Error('מבנה הקובץ שיוטיוב שלח לא נתמך'); };

  function list(b, start, end) {
    const out = [];
    for (let o = start; o + 8 <= end;) {
      let size = u32(b, o), hdr = 8;
      if (size === 1) { size = u32(b, o + 8) * 4294967296 + u32(b, o + 12); hdr = 16; }
      else if (size === 0) size = end - o;
      if (size < hdr || o + size > end) fail();
      out.push({ type: String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]), start: o, body: o + hdr, end: o + size });
      o += size;
    }
    return out;
  }
  const find = (b, parent, type) => (parent && list(b, parent.body, parent.end).find(x => x.type === type)) || fail();

  function box(type, parts) {
    const len = 8 + parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(len);
    w32(out, 0, len);
    out.set(ascii(type), 4);
    let o = 8;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  function parse(b) {
    const top = list(b, 0, b.length);
    const moov = top.find(x => x.type === 'moov') || fail();
    const trak = find(b, moov, 'trak');
    const mdhd = find(b, find(b, trak, 'mdia'), 'mdhd');
    const timescale = u32(b, mdhd.body + (b[mdhd.body] === 1 ? 20 : 12));
    const frags = [];
    for (let i = 0; i + 1 < top.length; i++) {
      if (top[i].type !== 'moof' || top[i + 1].type !== 'mdat') continue;
      const moof = top[i], traf = find(b, moof, 'traf'), tfhd = find(b, traf, 'tfhd');
      if (u32(b, tfhd.body) & 1) fail(); // base_data_offset מוחלט – ישתבש אחרי הזזה
      const tfdt = list(b, traf.body, traf.end).find(x => x.type === 'tfdt');
      const t = !tfdt ? 0 : b[tfdt.body] === 1
        ? u32(b, tfdt.body + 4) * 4294967296 + u32(b, tfdt.body + 8)
        : u32(b, tfdt.body + 4);
      frags.push({
        time: t / timescale,
        start: moof.start,
        end: top[i + 1].end,
        tfhd: tfhd.body + 4,
        mfhd: find(b, moof, 'mfhd').body + 4,
      });
    }
    if (!frags.length) fail();
    return { b, moov, trak, frags };
  }

  // ---------- MP4 רגיל (לא מפוצל) ----------
  // נגני Windows ("סרטים וטלוויזיה", Media Player) לא יודעים לקפוץ בתוך MP4 מפוצל בלי אינדקס,
  // ולפעמים מציגים רק שמע (דווח בפורום). לכן בונים MP4 "קלאסי": moov עם טבלאות דגימות מלאות
  // (stts/ctts/stsz/stsc/stco/stss) ו-mdat אחד. הנתונים עצמם לא מועתקים – רק מצביעים לחלקים.
  const full = (type, version, flags, parts) => {
    const vf = new Uint8Array(4);
    w32(vf, 0, flags);
    vf[0] = version;
    return box(type, [vf, ...parts]);
  };
  const u32arr = values => {
    const out = new Uint8Array(values.length * 4);
    values.forEach((v, i) => w32(out, i * 4, v >>> 0));
    return out;
  };
  const w64 = (b, o, v) => { w32(b, o, Math.floor(v / 4294967296)); w32(b, o + 4, v >>> 0); };

  // כל הדגימות של track אחד מתוך ה-moof/trun, לפי ברירות המחדל של trex/tfhd
  function samplesOf(t) {
    const { b } = t;
    const trex = find(b, find(b, t.moov, 'mvex'), 'trex');
    const def = { dur: u32(b, trex.body + 12), size: u32(b, trex.body + 16), flags: u32(b, trex.body + 20) };
    const top = list(b, 0, b.length);
    const chunks = [];
    for (let i = 0; i + 1 < top.length; i++) {
      if (top[i].type !== 'moof' || top[i + 1].type !== 'mdat') continue;
      const moof = top[i], mdat = top[i + 1];
      for (const traf of list(b, moof.body, moof.end).filter(x => x.type === 'traf')) {
        const kids = list(b, traf.body, traf.end);
        const tfhd = kids.find(x => x.type === 'tfhd') || fail();
        const tf = u32(b, tfhd.body) & 0xffffff;
        if (tf & 1) fail();
        let o = tfhd.body + 8;
        if (tf & 2) o += 4;
        const d = { ...def };
        if (tf & 8) { d.dur = u32(b, o); o += 4; }
        if (tf & 0x10) { d.size = u32(b, o); o += 4; }
        if (tf & 0x20) { d.flags = u32(b, o); o += 4; }
        const tfdt = kids.find(x => x.type === 'tfdt');
        let time = !tfdt ? null : b[tfdt.body] === 1
          ? u32(b, tfdt.body + 4) * 4294967296 + u32(b, tfdt.body + 8)
          : u32(b, tfdt.body + 4);
        let dataPos = mdat.body; // בלי data_offset: הנתונים מתחילים בתחילת ה-mdat
        for (const trun of kids.filter(x => x.type === 'trun')) {
          const tv = b[trun.body], rf = u32(b, trun.body) & 0xffffff;
          const count = u32(b, trun.body + 4);
          let p = trun.body + 8;
          if (rf & 1) { dataPos = moof.start + (u32(b, p) | 0); p += 4; }
          let firstFlags = null;
          if (rf & 4) { firstFlags = u32(b, p); p += 4; }
          const samples = [];
          let bytes = 0;
          for (let s = 0; s < count; s++) {
            const smp = { dur: d.dur, size: d.size, flags: s === 0 && firstFlags !== null ? firstFlags : d.flags, cto: 0 };
            if (rf & 0x100) { smp.dur = u32(b, p); p += 4; }
            if (rf & 0x200) { smp.size = u32(b, p); p += 4; }
            if (rf & 0x400) { smp.flags = u32(b, p); p += 4; }
            if (rf & 0x800) { smp.cto = tv === 1 ? (u32(b, p) | 0) : u32(b, p); p += 4; }
            bytes += smp.size;
            samples.push(smp);
          }
          if (dataPos + bytes > b.length) fail();
          if (time === null) time = chunks.length ? chunks[chunks.length - 1].end : 0;
          const dur = samples.reduce((n, s) => n + s.dur, 0);
          chunks.push({ samples, start: dataPos, bytes, time, end: time + dur });
          time += dur;
          dataPos += bytes;
        }
      }
    }
    if (!chunks.length) fail();
    return chunks;
  }

  // stts/ctts: רצפים של ערכים זהים
  const runs = values => {
    const out = [];
    for (const v of values) {
      const last = out[out.length - 1];
      if (last && last[1] === v) last[0]++;
      else out.push([1, v]);
    }
    return out;
  };

  function buildProgressive(inputs) {
    const tracks = inputs.map(b => {
      const t = parse(b);
      const mdia = find(b, t.trak, 'mdia');
      const mdhd = find(b, mdia, 'mdhd');
      const scale = u32(b, mdhd.body + (b[mdhd.body] === 1 ? 20 : 12));
      const chunks = samplesOf(t);
      const samples = chunks.flatMap(c => c.samples);
      return { ...t, mdia, mdhd, scale, chunks, samples, mediaDur: samples.reduce((n, s) => n + s.dur, 0) };
    });

    const first = tracks[0];
    const mvhdBox = find(first.b, first.moov, 'mvhd');
    const mvhd = first.b.slice(mvhdBox.start, mvhdBox.end);
    const mv1 = mvhd[8] === 1;
    const movieScale = u32(mvhd, mv1 ? 28 : 20);
    const movieDur = Math.max(...tracks.map(t => Math.round(t.mediaDur / t.scale * movieScale)));
    if (mv1) w64(mvhd, 32, movieDur); else w32(mvhd, 24, Math.min(movieDur, 0xffffffff));
    w32(mvhd, mv1 ? 116 : 104, tracks.length + 1);

    // סדר ה-chunks ב-mdat: משולבים לפי זמן, כדי שהנגן יקרא וידאו ושמע ביחד
    const order = tracks
      .flatMap((t, ti) => t.chunks.map(c => ({ c, ti, sec: c.time / t.scale })))
      .sort((a, b) => a.sec - b.sec || a.ti - b.ti);
    const totalData = order.reduce((n, x) => n + x.c.bytes, 0);
    const big = totalData + 1024 * 1024 > 0xffffffff; // mdat של 64 ביט ו-co64

    // בונים moov פעמיים: קודם כדי לדעת את הגודל שלו, ואז עם ההיסטים האמיתיים
    const ftyp = box('ftyp', [ascii('isom'), new Uint8Array([0, 0, 2, 0]), ascii('isomiso2avc1mp41')]);
    const makeMoov = dataStart => {
      const offsets = tracks.map(() => []);
      let pos = dataStart;
      for (const x of order) { offsets[x.ti].push(pos); pos += x.c.bytes; }
      // ה-chunks של כל track לפי סדר הופעתם ב-mdat (כלומר לפי זמן)
      const traks = tracks.map((t, ti) => {
        const b = t.b;
        const tkhdBox = find(b, t.trak, 'tkhd');
        const tkhd = b.slice(tkhdBox.start, tkhdBox.end);
        const tv1 = tkhd[8] === 1;
        w32(tkhd, 8 + (tv1 ? 20 : 12), ti + 1);
        const tDur = Math.round(t.mediaDur / t.scale * movieScale);
        if (tv1) w64(tkhd, 8 + 28, tDur); else w32(tkhd, 8 + 20, Math.min(tDur, 0xffffffff));

        const mdhd = b.slice(t.mdhd.start, t.mdhd.end);
        if (mdhd[8] === 1) w64(mdhd, 8 + 24, t.mediaDur); else w32(mdhd, 8 + 16, Math.min(t.mediaDur, 0xffffffff));
        const hdlr = find(b, t.mdia, 'hdlr');
        const minf = find(b, t.mdia, 'minf');
        const minfKids = list(b, minf.body, minf.end);
        const stbl = minfKids.find(x => x.type === 'stbl') || fail();
        const stsd = find(b, stbl, 'stsd');

        const sm = t.samples;
        const stts = runs(sm.map(s => s.dur));
        const ctts = sm.some(s => s.cto) ? runs(sm.map(s => s.cto)) : null;
        const sync = sm.map((s, i) => ((s.flags >>> 16) & 1 ? 0 : i + 1)).filter(Boolean);
        const stscRuns = [];
        t.chunks.forEach((c, i) => {
          const last = stscRuns[stscRuns.length - 1];
          if (!last || last[1] !== c.samples.length) stscRuns.push([i + 1, c.samples.length, 1]);
        });
        const co = big ? (() => {
          const arr = new Uint8Array(offsets[ti].length * 8);
          offsets[ti].forEach((v, i) => w64(arr, i * 8, v));
          return full('co64', 0, 0, [u32arr([offsets[ti].length]), arr]);
        })() : full('stco', 0, 0, [u32arr([offsets[ti].length]), u32arr(offsets[ti])]);

        const stblBoxes = [
          b.slice(stsd.start, stsd.end),
          full('stts', 0, 0, [u32arr([stts.length]), u32arr(stts.flat())]),
          ctts ? full('ctts', ctts.some(([, v]) => v < 0) ? 1 : 0, 0, [u32arr([ctts.length]), u32arr(ctts.flat())]) : null,
          sync.length && sync.length < sm.length ? full('stss', 0, 0, [u32arr([sync.length]), u32arr(sync)]) : null,
          full('stsc', 0, 0, [u32arr([stscRuns.length]), u32arr(stscRuns.flat())]),
          full('stsz', 0, 0, [u32arr([0, sm.length]), u32arr(sm.map(s => s.size))]),
          co,
        ].filter(Boolean);
        const minfOut = box('minf', [
          ...minfKids.filter(x => x.type !== 'stbl').map(x => b.slice(x.start, x.end)),
          box('stbl', stblBoxes),
        ]);
        // רשימת העריכה (edts/elst) של יוטיוב מזיזה את הווידאו בפריים אחד (B-frames) – בלעדיה הווידאו
        // מתחיל 67ms אחרי השמע. שומרים אותה, ומעדכנים את משך הקטע לאורך האמיתי
        const edtsBox = list(b, t.trak.body, t.trak.end).find(x => x.type === 'edts');
        let edts = null;
        if (edtsBox) {
          edts = b.slice(edtsBox.start, edtsBox.end);
          const elst = list(edts, 8, edts.length).find(x => x.type === 'elst');
          if (elst && u32(edts, elst.body + 4) === 1) {
            const ev1 = edts[elst.body] === 1;
            const mediaTime = ev1 ? u32(edts, elst.body + 16) * 4294967296 + u32(edts, elst.body + 20) : (u32(edts, elst.body + 12) | 0);
            // כמו אצל יוטיוב: משך הקטע = כל המדיה (ההיסט של mediaTime מתקזז בהיסטי הקומפוזיציה – אחרת הפריים האחרון נחתך)
            const seg = mediaTime >= 0 ? Math.round(t.mediaDur / t.scale * movieScale) : 0;
            if (ev1) w64(edts, elst.body + 8, seg); else w32(edts, elst.body + 8, Math.min(seg, 0xffffffff));
          }
        }
        return box('trak', [tkhd, ...(edts ? [edts] : []), box('mdia', [mdhd, b.slice(hdlr.start, hdlr.end), minfOut])]);
      });
      return box('moov', [mvhd, ...traks]);
    };
    const mdatHeader = big ? 16 : 8;
    let moov = makeMoov(0);
    moov = makeMoov(ftyp.length + moov.length + mdatHeader);

    const mdatHead = new Uint8Array(mdatHeader);
    if (big) { w32(mdatHead, 0, 1); mdatHead.set(ascii('mdat'), 4); w64(mdatHead, 8, totalData + 16); }
    else { w32(mdatHead, 0, totalData + 8); mdatHead.set(ascii('mdat'), 4); }
    const parts = [ftyp, moov, mdatHead];
    for (const x of order) parts.push(tracks[x.ti].b.subarray(x.c.start, x.c.start + x.c.bytes));
    return parts;
  }

  // inputs: מערך Uint8Array (וידאו ואז אודיו, או רק אודיו). מחזיר חלקים ל-Blob.
  // קודם MP4 רגיל (נפתח ונגלל בכל נגן); אם המבנה לא צפוי – MP4 מפוצל כמו קודם.
  function build(inputs, durationSec) {
    try {
      return buildProgressive(inputs);
    } catch (e) {
      return buildFragmented(inputs, durationSec);
    }
  }

  function buildFragmented(inputs, durationSec) {
    const tracks = inputs.map(parse);
    const first = tracks[0];
    const mvhd = first.b.slice(...(({ start, end }) => [start, end])(find(first.b, first.moov, 'mvhd')));
    const v1 = mvhd[8] === 1;
    const scale = u32(mvhd, v1 ? 28 : 20);
    const dur = durationSec > 0 ? Math.round(durationSec * scale) : 0;
    if (dur) {
      if (v1) { w32(mvhd, 32, Math.floor(dur / 4294967296)); w32(mvhd, 36, dur >>> 0); }
      else w32(mvhd, 24, dur);
    }
    w32(mvhd, v1 ? 116 : 104, tracks.length + 1); // next_track_ID

    const mvex = [];
    if (dur) {
      const mehd = new Uint8Array(8);
      w32(mehd, 4, Math.min(dur, 0xffffffff));
      mvex.push(box('mehd', [mehd]));
    }
    const traks = tracks.map((t, i) => {
      const trex = find(t.b, find(t.b, t.moov, 'mvex'), 'trex');
      const trexCopy = t.b.slice(trex.start, trex.end);
      w32(trexCopy, 12, i + 1);
      mvex.push(trexCopy);

      const trak = t.b.slice(t.trak.start, t.trak.end);
      const tkhd = list(trak, 8, trak.length).find(x => x.type === 'tkhd') || fail();
      const tv1 = trak[tkhd.body] === 1;
      w32(trak, tkhd.body + (tv1 ? 20 : 12), i + 1);
      if (dur) {
        if (tv1) { w32(trak, tkhd.body + 28, Math.floor(dur / 4294967296)); w32(trak, tkhd.body + 32, dur >>> 0); }
        else w32(trak, tkhd.body + 20, dur);
      }
      return trak;
    });

    const parts = [
      box('ftyp', [ascii('isom'), new Uint8Array([0, 0, 2, 0]), ascii('isomiso2iso6avc1mp41')]),
      box('moov', [mvhd, box('mvex', mvex), ...traks]),
    ];
    const frags = tracks
      .flatMap((t, i) => t.frags.map(f => ({ ...f, b: t.b, id: i + 1 })))
      .sort((a, b) => a.time - b.time || a.id - b.id);
    let seq = 1;
    for (const f of frags) {
      w32(f.b, f.tfhd, f.id);
      w32(f.b, f.mfhd, seq++);
      parts.push(f.b.subarray(f.start, f.end));
    }
    return parts;
  }

  return { build, buildProgressive, buildFragmented };
})();
