export const garageChoices=['siding1','trim','fascia'];
export const shutterChoices=['door','fascia','garage'];
export function validateScheme(scheme){
 if(!scheme||typeof scheme.id!=='string'||typeof scheme.name!=='string')throw Error('A scheme needs an id and name.');
 for(const k of ['siding1','siding2','trim','fascia'])if(!/^#[\da-f]{6}$/i.test(scheme[k]))throw Error('Invalid '+k+' color.');
 if(!Array.isArray(scheme.doors)||scheme.doors.length!==4)throw Error('Each scheme needs four door colors.');
 for(const door of scheme.doors)if(typeof door.name!=='string'||!/^#[\da-f]{6}$/i.test(door.color))throw Error('Invalid door option.');
 return scheme;
}
export function resolveColors(base,garageMatch,shutterMatch){
 if(!garageChoices.includes(garageMatch)||!shutterChoices.includes(shutterMatch))throw Error('Invalid matching choice.');
 const result={...base};result.garage=result[garageMatch];result.shutters=result[shutterMatch];return result;
}
