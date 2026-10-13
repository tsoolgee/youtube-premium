// עובד בדיקה: בודק שההזרקה של capture.js לא שוברת Worker רגיל
self.postMessage({ hello: 'from-worker', hooked: typeof MediaSource !== 'undefined' && MediaSource.prototype.addSourceBuffer.toString().includes('addSB') });
