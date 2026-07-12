// Инициализация карты
const map = L.map('map').setView([51.6605, 39.2003], 13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
}).addTo(map);
map.zoomControl.setPosition('bottomright');

let markers = [];
let userLocationCoords = null;
let userLocationMarker = null;
let geolocationWatchId = null;

let selectedTimeMinutes = null;

function createPopupContent(point) {
    const routeUrl = `https://yandex.ru/maps/?rtext=~${point.lat},${point.lng}&rtt=auto`;
    let contactsHtml = '';
    if (point.contacts && point.contacts.trim() !== '') {
        contactsHtml = `<div class="popup-contacts"><i class="fas fa-phone-alt"></i> ${point.contacts}</div>`;
    }
    let websiteHtml = '';
    if (point.website && point.website.trim() !== '') {
        let siteUrl = point.website.startsWith('http') ? point.website : 'https://' + point.website;
        websiteHtml = `<div class="popup-website"><i class="fas fa-globe"></i> <a href="${siteUrl}" target="_blank" rel="noopener noreferrer">${point.website}</a></div>`;
    }
    return `
        <div class="popup-inner">
            <div class="popup-title">${point.name}</div>
            <div class="popup-address"><i class="fas fa-location-dot"></i> ${point.address}</div>
            <div class="popup-hours"><i class="far fa-clock"></i> ${point.hours || 'не указан'}</div>
            ${contactsHtml}
            ${websiteHtml}
            <div class="popup-desc"><i class="fas fa-leaf"></i> ${point.description || ''}</div>
            <a href="${routeUrl}" target="_blank" class="route-btn"><i class="fas fa-directions"></i> Маршрут</a>
        </div>
    `;
}

function getSecondhandIcon(point) {
    let iconHtml;
    if (point.id === 188) {
        iconHtml = '<i class="fa-solid fa-shop" style="font-size: 16px; color: #E67E22; text-shadow: 0 0 2px white; background: white; border-radius: 50%; padding: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.2);"></i>';
    } else {
        iconHtml = '<i class="fa-solid fa-shirt" style="font-size: 16px; color: #9B59B6; text-shadow: 0 0 2px white; background: white; border-radius: 50%; padding: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.2);"></i>';
    }
    return L.divIcon({
        html: iconHtml,
        iconSize: [32, 32],
        popupAnchor: [0, -16],
        className: 'custom-marker-icon'
    });
}

function isOpenAtTime(point, timeMinutes) {
    if (point.hoursType === '24h') return true;
    if (point.hours && point.hours.toLowerCase().includes('круглосуточно')) return true;
    if (!point.hours || point.hours === 'не указан') return false;
    
    function parseRange(str) {
        let match = str.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
        if (!match) match = str.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
        if (!match) return null;
        if (match.length === 5) return { start: parseInt(match[1])*60+parseInt(match[2]), end: parseInt(match[3])*60+parseInt(match[4]) };
        if (match.length === 3) return { start: parseInt(match[1])*60, end: parseInt(match[2])*60 };
        return null;
    }
    const range = parseRange(point.hours);
    if (range) {
        if (range.start <= range.end) {
            return timeMinutes >= range.start && timeMinutes < range.end;
        } else {
            return timeMinutes >= range.start || timeMinutes < range.end;
        }
    }
    return false;
}

function filterByWorktime(point, filter) {
    if (!filter) return true;
    if (filter === 'all') {
        const timeToCheck = (selectedTimeMinutes !== null) ? selectedTimeMinutes : (new Date().getHours() * 60 + new Date().getMinutes());
        return isOpenAtTime(point, timeToCheck);
    }
    if (filter === '24h') return point.hoursType === '24h';
    if (filter === 'open_now') {
        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        return isOpenAtTime(point, currentTime);
    }
    return true;
}

function filterBySubtypes(point, activeWaterSubs, activeRecyclingSubs) {
    if (point.type === 'water') {
        if (activeWaterSubs.length === 0) return false;
        return activeWaterSubs.includes(point.waterSubtype);
    }
    if (point.type === 'recycling') {
        if (activeRecyclingSubs.length === 0) return false;
        return point.recyclingTypes && point.recyclingTypes.some(t => activeRecyclingSubs.includes(t));
    }
    return true;
}

function updateParentCheckboxes() {
    const waterSubs = document.querySelectorAll('.water-sub');
    const anyWaterChecked = Array.from(waterSubs).some(cb => cb.checked);
    const waterMain = document.getElementById('waterMain');
    if (waterMain) {
        if (!anyWaterChecked) {
            waterMain.checked = false;
        } else {
            waterMain.checked = true;
        }
    }
    const recSubs = document.querySelectorAll('.recycling-sub');
    const anyRecChecked = Array.from(recSubs).some(cb => cb.checked);
    const recMain = document.getElementById('recyclingMain');
    if (recMain) {
        if (!anyRecChecked) {
            recMain.checked = false;
        } else {
            recMain.checked = true;
        }
    }
}

function syncSubCheckboxes(mainId, subSelector) {
    const main = document.getElementById(mainId);
    if (!main) return;
    const subs = document.querySelectorAll(subSelector);
    main.addEventListener('change', function() {
        const isChecked = this.checked;
        subs.forEach(cb => {
            cb.checked = isChecked;
        });
        updateMarkers();
    });
    subs.forEach(cb => {
        cb.addEventListener('change', function() {
            updateParentCheckboxes();
            updateMarkers();
        });
    });
}

function getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2-lat1)*Math.PI/180;
    const dLng = (lng2-lng1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function updateMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    const activeTypes = [];
    document.querySelectorAll('.filter-cb:checked').forEach(cb => {
        const type = cb.getAttribute('data-type');
        if (type) activeTypes.push(type);
    });

    const activeWaterSubs = [];
    document.querySelectorAll('.water-sub:checked').forEach(cb => activeWaterSubs.push(cb.getAttribute('data-water-sub')));
    const activeRecyclingSubs = [];
    document.querySelectorAll('.recycling-sub:checked').forEach(cb => activeRecyclingSubs.push(cb.getAttribute('data-recycling-sub')));

    const districtSelect = document.getElementById('districtFilter');
    const district = districtSelect ? districtSelect.value : 'all';

    const activeWorkBtn = document.querySelector('.worktime-btn.active');
    let worktimeFilter = null;
    if (activeWorkBtn) {
        worktimeFilter = activeWorkBtn.getAttribute('data-value');
    }

    const nearbyCheckbox = document.getElementById('nearbyFilter');
    const nearbyEnabled = nearbyCheckbox ? nearbyCheckbox.checked : false;

    if (typeof ecoPoints === 'undefined') {
        console.error('ecoPoints не определён');
        return;
    }

    let count = 0;
    ecoPoints.forEach(point => {
        if (!activeTypes.includes(point.type)) return;
        if (district !== 'all' && point.district !== district) return;
        if (worktimeFilter !== null && !filterByWorktime(point, worktimeFilter)) return;
        if (!filterBySubtypes(point, activeWaterSubs, activeRecyclingSubs)) return;
        if (nearbyEnabled && userLocationCoords) {
            const dist = getDistance(userLocationCoords.lat, userLocationCoords.lng, point.lat, point.lng);
            if (dist > 2) return;
        }

        let marker;
        if (point.type === 'secondhand') {
            marker = L.marker([point.lat, point.lng], { icon: getSecondhandIcon(point) }).addTo(map);
        } else if (point.type === 'shop') {
            marker = L.marker([point.lat, point.lng], {
                icon: L.divIcon({
                    html: '<i class="fa-solid fa-shop" style="font-size: 16px; color: #E67E22; text-shadow: 0 0 2px white; background: white; border-radius: 50%; padding: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.2);"></i>',
                    iconSize: [32, 32],
                    popupAnchor: [0, -16],
                    className: 'custom-marker-icon'
                })
            }).addTo(map);
        } else {
            const color = typeColors && typeColors[point.type] ? typeColors[point.type] : '#888888';
            marker = L.circleMarker([point.lat, point.lng], {
                radius: 9,
                fillColor: color,
                color: "white",
                weight: 2.5,
                fillOpacity: 0.85
            }).addTo(map);
        }
        marker.bindPopup(createPopupContent(point), { className: 'custom-popup' });
        marker.pointData = point;
        markers.push(marker);
        count++;
    });
    // Отладочный вывод в консоль, чтобы видеть количество отображаемых точек
    console.log('Отображается точек:', count);
}



function searchPoints() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
        markers.forEach(m => { if (!map.hasLayer(m)) map.addLayer(m); });
        return;
    }
    markers.forEach(marker => {
        const p = marker.pointData;
        const match = p.name.toLowerCase().includes(query) || p.address.toLowerCase().includes(query);
        if (match) {
            if (!map.hasLayer(marker)) map.addLayer(marker);
        } else {
            if (map.hasLayer(marker)) map.removeLayer(marker);
        }
    });
}

function startGeolocation() {
    if (geolocationWatchId !== null) {
        navigator.geolocation.clearWatch(geolocationWatchId);
    }
    geolocationWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            userLocationCoords = { lat: latitude, lng: longitude };
            if (userLocationMarker) map.removeLayer(userLocationMarker);
            userLocationMarker = L.marker([latitude, longitude], {
                icon: L.divIcon({ html: '<i class="fas fa-location-dot" style="font-size:24px; color:#2c7a4d; text-shadow:0 0 3px white;"></i>', iconSize: [24,24] })
            }).addTo(map).bindPopup('Вы здесь').openPopup();
            const geoStatus = document.getElementById('geolocationStatus');
            if (geoStatus) geoStatus.innerHTML = '✓ Местоположение определено';
            updateMarkers();
        },
        (error) => {
            console.error(error);
            const geoStatus = document.getElementById('geolocationStatus');
            if (geoStatus) geoStatus.innerHTML = '⚠️ Не удалось определить местоположение. Разрешите доступ.';
            userLocationCoords = null;
            updateMarkers();
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
    );
}

function stopGeolocation() {
    if (geolocationWatchId !== null) {
        navigator.geolocation.clearWatch(geolocationWatchId);
        geolocationWatchId = null;
    }
    if (userLocationMarker) map.removeLayer(userLocationMarker);
    userLocationCoords = null;
    const geoStatus = document.getElementById('geolocationStatus');
    if (geoStatus) geoStatus.innerHTML = '';
    updateMarkers();
}

function populateTimeSelects() {
    const hourSelect = document.getElementById('hourSelect');
    const minuteSelect = document.getElementById('minuteSelect');
    if (!hourSelect || !minuteSelect) return;
    hourSelect.innerHTML = '';
    minuteSelect.innerHTML = '';
    for (let h = 0; h < 24; h++) {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = String(h).padStart(2, '0'); // только часы, без :00
        hourSelect.appendChild(opt);
    }
    for (let m = 0; m < 60; m += 5) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = String(m).padStart(2, '0'); // только минуты
        minuteSelect.appendChild(opt);
    }
    const now = new Date();
    hourSelect.value = now.getHours();
    minuteSelect.value = Math.floor(now.getMinutes() / 5) * 5;
}

document.addEventListener('DOMContentLoaded', () => {
    populateTimeSelects();

    syncSubCheckboxes('waterMain', '.water-sub');
    syncSubCheckboxes('recyclingMain', '.recycling-sub');

    const workBtns = document.querySelectorAll('.worktime-btn');
    workBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            if (this.classList.contains('active')) {
                this.classList.remove('active');
                if (this.getAttribute('data-value') === 'all') {
                    document.getElementById('timePicker').classList.remove('visible');
                }
            } else {
                workBtns.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                if (this.getAttribute('data-value') === 'all') {
                    document.getElementById('timePicker').classList.add('visible');
                } else {
                    document.getElementById('timePicker').classList.remove('visible');
                }
            }
            const allBtn = document.querySelector('.worktime-btn[data-value="all"]');
            if (!allBtn || !allBtn.classList.contains('active')) {
                selectedTimeMinutes = null;
                document.getElementById('selectedTimeDisplay').innerHTML = 'Выберите время';
            }
            updateMarkers();
        });
    });

    const applyBtn = document.getElementById('applyTimeBtn');
    if (applyBtn) {
        applyBtn.addEventListener('click', function() {
            const hour = parseInt(document.getElementById('hourSelect').value);
            const minute = parseInt(document.getElementById('minuteSelect').value);
            selectedTimeMinutes = hour * 60 + minute;
            const display = document.getElementById('selectedTimeDisplay');
            display.innerHTML = `Выбранное время: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            const allBtn = document.querySelector('.worktime-btn[data-value="all"]');
            if (allBtn && allBtn.classList.contains('active')) {
                updateMarkers();
            }
        });
    }

    document.querySelectorAll('.filter-cb').forEach(cb => cb.addEventListener('change', () => updateMarkers()));
    document.querySelectorAll('.water-sub, .recycling-sub').forEach(cb => cb.addEventListener('change', () => updateMarkers()));
    const districtFilter = document.getElementById('districtFilter');
    if (districtFilter) districtFilter.addEventListener('change', () => updateMarkers());

    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    if (searchBtn) searchBtn.addEventListener('click', () => { updateMarkers(); searchPoints(); });
    if (searchInput) searchInput.addEventListener('keypress', (e) => { if(e.key==='Enter'){ updateMarkers(); searchPoints(); } });

    const nearbyCheckbox = document.getElementById('nearbyFilter');
    if (nearbyCheckbox) {
        nearbyCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) startGeolocation();
            else stopGeolocation();
        });
    }

    const railToggle = document.getElementById('railToggle');
    const sidebarPanel = document.getElementById('sidebarPanel');
    const closePanelBtn = document.getElementById('closePanelBtn');
    const toggleIcon = document.getElementById('toggleIcon');
    if (railToggle && sidebarPanel && toggleIcon) {
        function openPanel() { sidebarPanel.classList.add('open'); toggleIcon.classList.remove('fa-chevron-right'); toggleIcon.classList.add('fa-chevron-left'); }
        function closePanel() { sidebarPanel.classList.remove('open'); toggleIcon.classList.remove('fa-chevron-left'); toggleIcon.classList.add('fa-chevron-right'); }
        railToggle.addEventListener('click', () => { if(sidebarPanel.classList.contains('open')) closePanel(); else openPanel(); });
    }
    if (closePanelBtn) closePanelBtn.addEventListener('click', () => {
        if (sidebarPanel) sidebarPanel.classList.remove('open');
        if (toggleIcon) { toggleIcon.classList.remove('fa-chevron-left'); toggleIcon.classList.add('fa-chevron-right'); }
    });

    const accountIcon = document.getElementById('accountIcon');
    if (accountIcon) accountIcon.addEventListener('click', () => alert('Личный кабинет в разработке'));
    const feedbackBtn = document.getElementById('feedbackBtn');
    if (feedbackBtn) feedbackBtn.addEventListener('click', () => alert('Форма обратной связи: напишите нам на levitskayadarina@gamil.com'));

    // Первоначальное обновление маркеров
    updateMarkers();
});

// Перерисовка карты при изменении размера окна (адаптивность)
window.addEventListener('resize', function() {
    if (map) {
        map.invalidateSize();
    }
});