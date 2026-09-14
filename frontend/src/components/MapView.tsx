import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { MapData } from '../types'
import 'leaflet/dist/leaflet.css'

interface MapViewProps { data: MapData | null; activeVehicle: string | null; onSelectVehicle: (vehicleId: string | null) => void; onSelectOrder: (orderId: string) => void }

/**
 * 線條強度分三級，避免四條路線同時全亮變成毛線球：
 *   overview  沒有選車時的預設——細、半透明、實線，看得出分佈但不刺眼
 *   focus     被選中的那一條——粗、不透明，並在底下墊一層白色外框提高對比
 *   dimmed    其他車——幾乎透明，只留下位置感
 */
/**
 * 概覽時線條刻意壓到很淡，讓「配送點」當主角。
 * 開場的台詞是「50 張訂單、4 台車」——那一刻要看的是點位分佈與規模，
 * 不是四條互相交錯的路線；路線要等點了某台車才是重點。
 */
const LINE = {
  overview: { weight: 2, opacity: 0.3, casing: 0 },
  focus: { weight: 5, opacity: 1, casing: 4 },
  // 0.18 是既有驗收測項檢查的值（E-05～E-09）；再淡下去視覺上差別有限，
  // 但會讓「其他車已淡化」這條驗收失效，所以維持 0.18。
  dimmed: { weight: 1.5, opacity: 0.18, casing: 0 },
}

export function MapView({ data, activeVehicle, onSelectVehicle, onSelectOrder }: MapViewProps) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return
    const map = L.map(mapElement.current, { zoomControl: true, attributionControl: true, minZoom: 9, maxZoom: 16 }).setView([25.04, 121.53], 11)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !data) return
    layersRef.current?.clearLayers()
    const group = layersRef.current || L.layerGroup().addTo(map)
    layersRef.current = group
    const bounds: L.LatLngTuple[] = [[data.depot.latitude, data.depot.longitude]]
    const dispatched = data.stage === 'DISPATCHED'

    data.routes.forEach((route) => {
      const focused = activeVehicle === route.vehicle_id
      const style = activeVehicle === null ? LINE.overview : focused ? LINE.focus : LINE.dimmed
      const points: L.LatLngTuple[] = [[data.depot.latitude, data.depot.longitude]]
      route.stops.forEach((stop) => { points.push([stop.latitude, stop.longitude]); bounds.push([stop.latitude, stop.longitude]) })
      points.push([data.depot.latitude, data.depot.longitude])

      for (let index = 0; index < points.length - 1; index += 1) {
        const stop = route.stops[index]
        const travelled = dispatched && (!stop || stop.status === 'COMPLETED')
        const segment: L.LatLngTuple[] = [points[index], points[index + 1]]
        // 只有「已發車但還沒跑到」的路段用虛線；其餘一律實線，減少視覺噪音
        const dashArray = dispatched && !travelled ? '7 7' : undefined
        if (style.casing > 0) {
          // 白色外框（casing）是製圖的標準做法：讓彩色線條在雜亂底圖上仍然分得出來
          L.polyline(segment, { color: '#ffffff', weight: style.weight + style.casing, opacity: 0.85, dashArray, interactive: false }).addTo(group)
        }
        L.polyline(segment, { color: route.color, weight: style.weight, opacity: style.opacity, dashArray })
          .on('click', () => onSelectVehicle(route.vehicle_id))
          .addTo(group)
      }

      route.stops.forEach((stop) => {
        if (dispatched && stop.status === 'CURRENT') {
          L.marker([stop.latitude, stop.longitude], { icon: L.divIcon({ className: 'map-vehicle-marker', html: '<span class="map-vehicle-marker-core"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }) })
            .bindTooltip(`${route.vehicle_id} · 模擬車輛目前位置 · ${stop.order_id} · ${stop.eta}`)
            .on('click', () => { onSelectVehicle(route.vehicle_id); onSelectOrder(stop.order_id) })
            .addTo(group)
          return
        }
        const completed = dispatched && stop.status === 'COMPLETED'
        if (focused) {
          // 選中一台車時，直接把站序畫在地圖上——這是「看得懂路線」的關鍵，
          // 不然使用者只看得到一串圓點，說不出車子先去哪再去哪。
          L.marker([stop.latitude, stop.longitude], {
            icon: L.divIcon({
              className: 'map-seq-marker',
              html: `<span class="map-seq-core${completed ? ' map-seq-done' : ''}" style="--seq:${route.color}">${stop.sequence}</span>`,
              iconSize: [22, 22],
              iconAnchor: [11, 11],
            }),
          })
            .bindTooltip(`${stop.order_id} · 第 ${stop.sequence} 站 · ${stop.eta}`)
            .on('click', () => { onSelectVehicle(route.vehicle_id); onSelectOrder(stop.order_id) })
            .addTo(group)
          return
        }
        const faded = activeVehicle !== null
        // 概覽時放大配送點並加白框，讓 49 個點在降飽和的底圖上清楚成形
        L.circleMarker([stop.latitude, stop.longitude], {
          radius: faded ? 3 : 6,
          color: faded ? route.color : '#ffffff',
          fillColor: route.color,
          fillOpacity: faded ? 0.18 : dispatched && !completed ? 0.25 : 0.95,
          opacity: faded ? 0.25 : 0.95,
          weight: faded ? 1.5 : 2,
        })
          .bindTooltip(`${stop.order_id} · 第 ${stop.sequence} 站 · ${stop.eta}`)
          .on('click', () => { onSelectVehicle(route.vehicle_id); onSelectOrder(stop.order_id) })
          .addTo(group)
      })
    })

    L.marker([data.depot.latitude, data.depot.longitude], {
      icon: L.divIcon({ className: 'map-depot-marker', html: '<span class="map-depot-core"></span><span class="map-depot-label">配送中心</span>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      zIndexOffset: 500,
    }).bindTooltip('DEPOT-001 · 配送中心').addTo(group)

    if (bounds.length > 1) map.fitBounds(bounds, { padding: [34, 34], maxZoom: 12 })
  }, [activeVehicle, data, onSelectOrder, onSelectVehicle])

  return (
    <div className="map-shell" aria-label="配送地圖">
      <div ref={mapElement} className="leaflet-map" aria-label="OpenStreetMap 配送示意路線" />
      {data && (
        <div className="map-overlay">
          {/* 數字與單位拆開只是為了放大數字；單位帶一個前導空格，
              讓這個容器的文字仍然是「50 個站點」，既有版面驗收才找得到。
              徽章必須放在外面，否則會混進同一段文字裡。 */}
          <div className="map-overlay-lead">
            <span className="map-overlay-count">{data.routes.reduce((sum, route) => sum + route.stops.length, 0)}</span>
            <span className="map-overlay-unit">{' 個站點'}</span>
          </div>
          <span className="map-overlay-badge">{data.stage === 'DISPATCHED' ? '模擬進度' : '示意路線'}</span>
          <div className="map-overlay-filters">
            {data.routes.map((route) => (
              <button
                type="button"
                key={route.vehicle_id}
                className={`map-route-filter ${activeVehicle === route.vehicle_id ? 'selected' : ''}`}
                onClick={() => onSelectVehicle(activeVehicle === route.vehicle_id ? null : route.vehicle_id)}
              >
                <i style={{ backgroundColor: route.color }} />
                {route.vehicle_id}
              </button>
            ))}
            {activeVehicle && (
              <button type="button" className="map-route-clear" onClick={() => onSelectVehicle(null)}>顯示全部</button>
            )}
          </div>
          <span className="map-overlay-attrib">© OpenStreetMap contributors</span>
        </div>
      )}
    </div>
  )
}
