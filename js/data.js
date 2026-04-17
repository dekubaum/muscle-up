// js/data.js
window.PLAN = {
  phases: [
    {
      number: 1,
      name: 'Phase 1 – Explosive Kraft & Körperbewusstsein',
      weeks: '1–3',
      totalSessions: 6,
      exercises: [
        { id: 'explosive-pullups',  name: 'Explosive Pull-Ups',              sets: 4, reps: '5',       focus: 'So hoch wie möglich, Brust zur Stange' },
        { id: 'chest-to-bar',       name: 'Chest-to-Bar Pull-Ups (mit Band)', sets: 3, reps: '6–8',    focus: 'Stange bis zur Brust' },
        { id: 'dips',               name: 'Dips (langsam, kontrolliert)',     sets: 4, reps: '8',       focus: 'Basis für die Push-Phase' },
        { id: 'hollow-body',        name: 'Hollow Body Hold',                sets: 3, reps: '20 Sek.', focus: 'Ganzkörperspannung' },
        { id: 'scapular-pullups',   name: 'Scapular Pull-Ups',               sets: 3, reps: '10',      focus: 'Schulterblatt-Kontrolle' },
      ],
    },
    {
      number: 2,
      name: 'Phase 2 – Transition trainieren',
      weeks: '4–6',
      totalSessions: 6,
      exercises: [
        { id: 'band-muscle-up',    name: 'Band-Assisted Muscle Up',         sets: 4, reps: '4–5',    focus: 'Bewegungsablauf kennenlernen' },
        { id: 'negative-muscle-up', name: 'Negative Muscle Ups',            sets: 3, reps: '3–4',    focus: 'Langsam absenken (3–5 Sek.)' },
        { id: 'jump-muscle-up',    name: 'Jump Muscle Up (Sprungstart)',     sets: 3, reps: '3',      focus: 'Transition spüren' },
        { id: 'weighted-dips',     name: 'Dips (gewichtet oder langsam)',    sets: 3, reps: '8',      focus: 'Push-Phase stärken' },
        { id: 'l-sit',             name: 'L-Sit Hold',                      sets: 3, reps: '15 Sek.', focus: 'Körperspannung, Hüftbeuger' },
      ],
    },
    {
      number: 3,
      name: 'Phase 3 – Erster Muscle Up',
      weeks: '7–10',
      totalSessions: 8,
      exercises: [
        { id: 'muscle-up-attempts',       name: 'Muscle Up Versuche (unassisted)',    sets: 1, reps: '5–6 Versuche', focus: 'Volle Erholung (2–3 Min.) zwischen Versuchen' },
        { id: 'band-muscle-up-finisher',  name: 'Band-Assisted Muscle Up (Finisher)', sets: 2, reps: '3',           focus: 'Wenn Versuche scheitern' },
        { id: 'explosive-pullups-p3',     name: 'Explosive Pull-Ups',                sets: 3, reps: '4',            focus: 'Kraft erhalten' },
        { id: 'dips-p3',                  name: 'Dips',                              sets: 3, reps: '10',           focus: 'Push-Phase stabil halten' },
        { id: 'ring-rows',                name: 'Ring Rows oder Rudern',             sets: 3, reps: '10',           focus: 'Rücken ausbalancieren' },
      ],
    },
  ],
  phase3Checklist: [
    '3 saubere Chest-to-Bar Pull-Ups ohne Band',
    '1–2 Negative Muscle Ups mit Kontrolle (mind. 3 Sek. Absenkzeit)',
    'Explosive Pull-Ups erreichen konstant Kinnhöhe über der Stange',
  ],
};
