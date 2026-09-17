import { TEAM, TYPES, minutes, timeValue, interval, overlaps, assignAppointments } from './booking-schedule.mjs';

const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const escapeAttribute = escapeHTML;
const dateToValue = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const formatDisplayDate = value => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const formatTime = value => { const [h, m] = value.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
let selectedDate = new Date();
let calendarView = 'day';
let calendarVersion = 0;
let availabilityVersion = 0;

async function api(action, options = {}) {
  const { query = {}, ...init } = options;
  const response = await fetch(`/.netlify/functions/booking-api?${new URLSearchParams({ action, ...query })}`, { ...init, cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load scheduling data.');
  return result;
}

function setCalendarView(view) {
  calendarView = view;
  $('dayView').setAttribute('aria-pressed', String(view === 'day'));
  $('weekView').setAttribute('aria-pressed', String(view === 'week'));
  loadCalendar();
}
function navigateCalendar(direction) {
  selectedDate = addDays(selectedDate, direction * (calendarView === 'week' ? 7 : 1));
  loadCalendar();
}
function goToToday() { selectedDate = new Date(); loadCalendar(); }

function availabilityMarkup(data) {
  return Object.entries(TYPES).map(([type, config]) => {
    const slots = data[type] || [];
    return `<div class="slot-summary"><strong>${config.label}</strong> ${slots.length ? slots.map(slot => `<span>${formatTime(slot.time)} · ${slot.remaining} ${slot.remaining === 1 ? 'spot' : 'spots'}</span>`).join('') : '<span>No availability</span>'}</div>`;
  }).join('');
}

function assignmentControl(item) {
  return `<div class="assignment-control"><label>Consultant<select aria-label="Consultant for ${escapeHTML(item.name)}">${['', ...TEAM].map(person => `<option value="${person}" ${person === (item.assignedTo || '') ? 'selected' : ''}>${person || 'Unassigned'}</option>`).join('')}</select></label><button class="btn" type="button" data-assignment-save="${escapeHTML(item.id)}">Save assignment</button><span class="assignment-feedback" role="status"></span></div>`;
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-assignment-save]');
  if (!button) return;
  const control = button.closest('.assignment-control');
  const feedback = control.querySelector('.assignment-feedback');
  button.disabled = true;
  feedback.textContent = 'Saving…';
  try {
    await api('assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: button.dataset.assignmentSave, assignedTo: control.querySelector('select').value }) });
    await loadAdminData();
  } catch (error) {
    feedback.textContent = error.message;
    button.disabled = false;
  }
});

function dayMarkup(data) {
  const requests = (data.requests || []).filter(item => TYPES[item.type]);
  const rules = data.rules || [];
  const assignments = assignAppointments(requests, rules, data.date);
  const timedRules = rules.filter(rule => rule.startTime && rule.endTime && rule.kind !== 'virtual');
  const allDayRules = rules.filter(rule => !rule.startTime || rule.kind === 'virtual');
  const ranges = [...requests.map(interval), ...timedRules.map(rule => ({ start: minutes(rule.startTime), end: minutes(rule.endTime) }))];
  const start = Math.floor(Math.min(9 * 60, ...ranges.map(range => range.start)) / 30) * 30;
  const end = Math.ceil(Math.max(18 * 60, ...ranges.map(range => range.end)) / 30) * 30;
  const rowHeight = 52;
  const height = (end - start) / 30 * rowHeight;
  const position = range => `top:${(range.start - start) / 30 * rowHeight}px;height:${(range.end - range.start) / 30 * rowHeight}px;`;
  const lanes = TEAM.map(() => []);
  const placed = TEAM.map(() => []);
  let conflicts = !assignments && requests.length > 0;
  rules.filter(rule => ['off', 'meeting', 'virtual'].includes(rule.kind)).forEach(rule => {
    const range = { start: rule.startTime ? minutes(rule.startTime) : start, end: rule.endTime ? minutes(rule.endTime) : end };
    TEAM.forEach((person, lane) => {
      if (rule.person && rule.person !== person) return;
      lanes[lane].push(`<div class="schedule-rule ${rule.kind}" style="${position(range)}"><strong>${escapeHTML(rule.person || 'Studio')} ${{ off: 'OFF', meeting: 'Meeting / Block', virtual: 'Virtual Only' }[rule.kind]}</strong><span>${escapeHTML(rule.label)}${rule.startTime ? ` · ${formatTime(rule.startTime)}–${formatTime(rule.endTime)}` : ' · All day'}</span></div>`);
    });
  });
  const overflow = [];
  requests.forEach((item, index) => {
    if (!TEAM.includes(item.assignedTo)) return;
    const range = interval(item);
    const lane = TEAM.indexOf(item.assignedTo);
    const endTime = timeValue(range.end);
    const description = `${TYPES[item.type].label} · ${item.name} · ${formatTime(item.time)}–${formatTime(endTime)} · ${item.status}${item.assignedTo ? ` · ${item.assignedTo}` : ''}`;
    if (placed[lane].some(entry => overlaps(entry, range))) { overflow.push(description); return; }
    placed[lane].push(range);
    lanes[lane].push(`<div class="schedule-appointment ${item.status === 'confirmed' ? 'confirmed' : 'requested'} ${item.type === 'discovery' ? 'discovery' : ''}" style="${position(range)}" tabindex="0" title="${escapeHTML(description)}" aria-label="${escapeHTML(description)}"><div class="appointment-heading">${TYPES[item.type].label} · ${escapeHTML(item.name)}</div><div class="appointment-time">${formatTime(item.time)}–${formatTime(endTime)}${item.assignedTo ? ` · ${escapeHTML(item.assignedTo)}` : ''}</div>${item.type !== 'discovery' ? `<span class="appointment-status">${item.status === 'confirmed' ? 'C3 Confirmed' : 'Requested'}</span>` : ''}</div>`);
  });
  if (assignments) {
    const boundaries = [...new Set([start, end, ...requests.flatMap(item => Object.values(interval(item))), ...rules.flatMap(rule => [rule.startTime ? minutes(rule.startTime) : start, rule.endTime ? minutes(rule.endTime) : end])])].sort((a, b) => a - b);
    const deskRanges = TEAM.map(() => []);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const range = { start: boundaries[i], end: boundaries[i + 1] };
      if (requests.some(item => !item.assignedTo && item.type !== 'discovery' && overlaps(interval(item), range))) continue;
      if (!requests.some(item => item.type !== 'discovery' && overlaps(interval(item), range))) continue;
      const lane = TEAM.findIndex((person, index) => {
        const inLongAppointment = requests.some(item => item.assignedTo === person && item.type !== 'discovery' && overlaps(interval(item), range));
        const unavailable = rules.some(rule => (!rule.person || rule.person === person) && overlaps({ start: rule.startTime ? minutes(rule.startTime) : start, end: rule.endTime ? minutes(rule.endTime) : end }, range));
        return !inLongAppointment && !unavailable;
      });
      if (lane < 0) continue;
      const previous = deskRanges[lane].at(-1);
      if (previous?.end === range.start) previous.end = range.end;
      else deskRanges[lane].push(range);
    }
    deskRanges.forEach((ranges, lane) => ranges.forEach(range => lanes[lane].unshift(`<div class="schedule-desk" style="${position(range)}"><strong>Available for front desk</strong><span>Discoveries welcome</span></div>`)));
  }
  const ticks = [];
  for (let time = start; time < end; time += 30) ticks.push(`<div class="time-tick" style="top:${(time - start) / 30 * rowHeight}px">${formatTime(timeValue(time))}</div>`);
  return `<section class="day-schedule">
    <div class="staffing-notes">${allDayRules.map(rule => `<span class="staff-note ${rule.kind}">${escapeHTML(rule.label || `${rule.person || 'Studio'} ${rule.kind}`)}${rule.startTime ? ` · ${formatTime(rule.startTime)}–${formatTime(rule.endTime)}` : ' · All day'}</span>`).join('')}</div>
    <p class="desk-note">One in-person team member stays available for front desk and can still conduct Discoveries. Virtual and Final appointments share capacity.</p>
    ${requests.some(item => !TEAM.includes(item.assignedTo)) ? `<section class="unassigned-requests"><h3>Unassigned requests</h3><p>These appointments hold capacity but have not been assigned to a consultant.</p>${requests.filter(item => !TEAM.includes(item.assignedTo)).map(item => `<div class="unassigned-request"><strong>${escapeHTML(item.name)} · ${TYPES[item.type].label}</strong><div>${formatTime(item.time)}–${formatTime(timeValue(interval(item).end))} · ${item.status === 'confirmed' ? 'C3 Confirmed' : 'Requested'}</div>${assignmentControl(item)}</div>`).join('')}</section>` : ''}
    ${conflicts ? '<p class="schedule-warning" role="alert">Existing appointments conflict with current staffing rules. Review these bookings; no appointments have been changed.</p>' : ''}
    ${overflow.length ? `<div class="schedule-warning">Additional overlapping bookings: ${overflow.map(escapeHTML).join('<br>')}</div>` : ''}
    <p class="mobile-scroll-hint">Swipe across to see all three consultants.</p>
    <div class="schedule-scroll"><div class="schedule-inner">
      <div class="schedule-head"><span>Time</span>${TEAM.map(person => `<strong>${person}</strong>`).join('')}</div>
      <div class="schedule-grid" style="height:${height}px"><div class="time-axis">${ticks.join('')}</div>${lanes.map(events => `<div class="schedule-lane">${events.join('')}</div>`).join('')}</div>
    </div></div>
    <details class="day-availability"><summary>Available appointment times</summary>${availabilityMarkup(data.availability || {})}</details>
  </section>`;
}

function weekMarkup(days) {
  return days.map(data => `<section class="calendar-day ${data.date === dateToValue(new Date()) ? 'today' : ''}"><button class="week-day-link" type="button" data-date="${data.date}">${formatDisplayDate(data.date)}</button><div class="week-day-content">${(data.rules || []).map(rule => `<div class="calendar-item ${rule.kind}"><strong>${escapeHTML(rule.label)}</strong><div>${rule.startTime ? `${formatTime(rule.startTime)}–${formatTime(rule.endTime)}` : 'All day'}</div></div>`).join('')}${(data.requests || []).map(item => `<div class="calendar-item ${item.status === 'confirmed' ? 'confirmed' : 'requested'}"><strong>${escapeHTML(item.typeLabel || TYPES[item.type]?.label || item.type)}</strong><div>${escapeHTML(item.name)}</div><div class="week-consultant">${escapeHTML(item.assignedTo || "Unassigned")}</div><div>${formatTime(item.time)} · ${TYPES[item.type]?.duration || ''} min</div></div>`).join('')}${availabilityMarkup(data.availability || {})}</div></section>`).join('');
}

async function loadCalendar() {
  const version = ++calendarVersion;
  const view = calendarView;
  let dates = [selectedDate];
  if (view === 'week') {
    const tuesday = addDays(selectedDate, -((selectedDate.getDay() + 5) % 7));
    dates = Array.from({ length: 5 }, (_, i) => addDays(tuesday, i));
  }
  $('weekLabel').textContent = view === 'day' ? formatDisplayDate(dateToValue(selectedDate)) : `${formatDisplayDate(dateToValue(dates[0]))} – ${formatDisplayDate(dateToValue(dates[4]))}`;
  $('calendarGrid').className = view === 'day' ? 'calendar-day-container' : 'calendar-grid';
  $('calendarGrid').innerHTML = '<div class="calendar-empty" role="status">Loading Studio calendar…</div>';
  try {
    const days = await Promise.all(dates.map(date => api('calendar-day', { query: { date: dateToValue(date) } })));
    if (version !== calendarVersion) return;
    $('calendarGrid').innerHTML = view === 'day' ? dayMarkup(days[0]) : weekMarkup(days);
  } catch (error) {
    if (version === calendarVersion) $('calendarGrid').innerHTML = `<div class="calendar-empty" role="alert">${escapeHTML(error.message)}</div>`;
  }
}

async function loadAvailabilityPanel() {
  const version = ++availabilityVersion;
  const date = $('availabilityDate').value;
  if (!date) { $('availabilityPanel').textContent = 'Choose a date to view availability.'; return; }
  $('availabilityPanel').textContent = 'Checking availability…';
  try {
    const entries = await Promise.all(Object.keys(TYPES).map(async type => [type, (await api('availability', { query: { type, date } })).slots]));
    if (version === availabilityVersion) $('availabilityPanel').innerHTML = availabilityMarkup(Object.fromEntries(entries));
  } catch (error) { if (version === availabilityVersion) $('availabilityPanel').textContent = error.message; }
}

async function loadAdminData() {
  await Promise.all([loadCalendar(), loadAvailabilityPanel(), (async () => {
    try {
      const [requests, rules] = await Promise.all([api('requests'), api('rules')]);
      renderRequests(requests.requests || []);
      renderRules(rules.rules || []);
    } catch (error) { $('requestList').textContent = error.message; $('ruleList').textContent = error.message; }
  })()]);
}

Object.assign(window, { setCalendarView, navigateCalendar, goToToday, loadAdminData, loadAvailabilityPanel, updateRequestStatus, deleteRule });
$('calendarGrid').addEventListener('click', event => {
  const button = event.target.closest('[data-date]');
  if (button) { selectedDate = new Date(`${button.dataset.date}T12:00:00`); setCalendarView('day'); }
});
for (const id of ['ruleStartTime', 'ruleEndTime']) {
  $(id).innerHTML = '<option value="">All day / no time</option>' + Array.from({ length: 48 }, (_, i) => `<option value="${timeValue(i * 30)}">${formatTime(timeValue(i * 30))}</option>`).join('');
}
$('availabilityDate').value = dateToValue(new Date());

// Request and rule actions are retained below from the existing admin page.
    function renderRequests(
      requests
    ) {

      const list =
        document.getElementById(
          "requestList"
        );


      if (
        !requests.length
      ) {

        list.innerHTML = `

          <div class="empty">
            No appointment requests yet.
          </div>

        `;

        return;

      }


      list.innerHTML =
        requests
          .map(
            request => `

              <div class="request-card">

                <div class="request-top">

                  <div>

                    <div class="request-name">
                      ${escapeHTML(request.name)}
                    </div>

                    <div class="request-meta">

                      ${escapeHTML(
                        request.typeLabel ||
                        request.type ||
                        ""
                      )}

                      •

                      ${escapeHTML(
                        request.dateLabel ||
                        request.date ||
                        ""
                      )}

                      at

                      ${escapeHTML(
                        request.timeLabel ||
                        request.time ||
                        ""
                      )}

                    </div>

                  </div>


                  <span
                    class="status-badge ${escapeHTML(request.status)}"
                  >
                    ${escapeHTML(request.status)}
                  </span>

                </div>


                ${request.status !== 'declined' ? assignmentControl(request) : ''}
                <div class="request-details">

                  ${
                    request.community
                      ? `
                        <strong>Community:</strong>
                        ${escapeHTML(request.community)}
                        <br>
                      `
                      : ""
                  }

                  ${
                    request.address
                      ? `
                        <strong>Address / Lot:</strong>
                        ${escapeHTML(request.address)}
                        <br>
                      `
                      : ""
                  }

                  <strong>Email:</strong>
                  ${escapeHTML(request.email || "")}

                  <br>

                  <strong>Phone:</strong>
                  ${escapeHTML(request.phone || "")}

                  ${
                    request.notes
                      ? `
                        <br><br>
                        <strong>Notes:</strong>
                        ${escapeHTML(request.notes)}
                      `
                      : ""
                  }

                </div>


                ${
                  request.status ===
                    "requested"
                    ? `

                      <div class="request-actions">

                        <button
                          class="btn btn-confirm"
                          type="button"
                          onclick="
                            updateRequestStatus(
                              '${escapeHTML(request.id)}',
                              'confirmed'
                            )
                          "
                        >
                          Confirm After C3 Booking
                        </button>


                        <button
                          class="btn btn-decline"
                          type="button"
                          onclick="
                            updateRequestStatus(
                              '${escapeHTML(request.id)}',
                              'declined'
                            )
                          "
                        >
                          Decline / Release Slot
                        </button>

                      </div>

                    `
                    : ""
                }

              </div>

            `
          )
          .join("");

    }



    /* =====================================================
       UPDATE REQUEST STATUS
       ===================================================== */

    async function updateRequestStatus(
      id,
      status
    ) {

      let message;


      if (
        status ===
        "confirmed"
      ) {

        message =
          "Confirm that this appointment has been booked in C3?";

      } else {

        message = 
                    "Decline this appointment request and release the time?";

      }


      if (
        !confirm(
          message
        )
      ) {

        return;

      }


      try {

        await api(
          "status",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                id,
                status
              })
          }
        );


        await loadAdminData();


      } catch (error) {

        alert(
          error.message
        );

      }

    }



    /* =====================================================
       LOAD RULES
       ===================================================== */

    function renderRules(
      rules
    ) {

      const container =
        document.getElementById(
          "ruleList"
        );


      if (
        !Array.isArray(rules) ||
        rules.length === 0
      ) {

        container.innerHTML = `

          <div class="empty">
            No scheduling rules or blocks yet.
          </div>

        `;

        return;

      }


      container.innerHTML =
        rules.map(
          rule => {

            let scheduleText =
              "";


            if (
              rule.recurrence ===
              "once"
            ) {

              scheduleText =
                rule.startDate
                  ? formatDisplayDate(
                      rule.startDate
                    )
                  : "One date";

            } else {

              scheduleText =
                rule.weekdayLabel
                  ? `Every ${rule.weekdayLabel}`
                  : "Recurring";

            }


            let timeText =
              "All Day";


            if (
              rule.startTime &&
              rule.endTime
            ) {

              timeText =
                `${formatTime(rule.startTime)} – ` +
                `${formatTime(rule.endTime)}`;

            }


            let dateRange =
              "";


            if (
              rule.recurrence ===
                "weekly" &&
              (
                rule.startDate ||
                rule.endDate
              )
            ) {

              dateRange = `

                <div class="rule-meta">

                  ${
                    rule.startDate
                      ? `Starts ${
                          formatDisplayDate(
                            rule.startDate
                          )
                        }`
                      : ""
                  }

                  ${
                    rule.startDate &&
                    rule.endDate
                      ? " • "
                      : ""
                  }

                  ${
                    rule.endDate
                      ? `Ends ${
                          formatDisplayDate(
                            rule.endDate
                          )
                        }`
                      : ""
                  }

                </div>

              `;

            }


            return `

              <div class="rule-card">

                <div class="rule-name">
                  ${
                    escapeHTML(
                      rule.label ||
                      "Scheduling Rule"
                    )
                  }
                </div>


                <div class="rule-meta">

                  ${
                    escapeHTML(
                      rule.person ||
                      "Entire Studio"
                    )
                  }

                  •

                  ${
                    escapeHTML(
                      scheduleText
                    )
                  }

                  •

                  ${
                    escapeHTML(
                      timeText
                    )
                  }

                </div>


                ${dateRange}


                <div class="rule-actions">

                  <button
                    class="btn btn-decline"
                    type="button"
                    onclick="
                      deleteRule(
                        '${
                          escapeAttribute(
                            rule.id
                          )
                        }'
                      )
                    "
                  >
                    Delete Rule
                  </button>

                </div>

              </div>

            `;

          }
        )
        .join("");

    }



    /* =====================================================
       SAVE RULE
       ===================================================== */

    document
      .getElementById(
        "ruleForm"
      )
      .addEventListener(
        "submit",
        async event => {

          event.preventDefault();


          const form =
            event.currentTarget;


          const data =
            Object.fromEntries(
              new FormData(
                form
              )
              .entries()
            );


          try {

            await api(
              "rule",
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json"
                },

                body:
                  JSON.stringify(
                    data
                  )
              }
            );


            form.reset();


            await loadAdminData();


          } catch (error) {

            alert(
              error.message
            );

          }

        }
      );



    /* =====================================================
       DELETE RULE
       ===================================================== */

    async function deleteRule(
      id
    ) {

      if (
        !confirm(
          "Delete this scheduling rule?"
        )
      ) {

        return;

      }


      try {

        await api(
          "delete-rule",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                id
              })
          }
        );


        await loadAdminData();


      } catch (error) {

        alert(
          error.message
        );

      }

    }



    /* =====================================================
       AVAILABILITY PANEL
       ===================================================== */


loadAdminData();
