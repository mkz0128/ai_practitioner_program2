import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader } from '@googlemaps/js-api-loader'
import type { MapData, MapRoute } from '../types'

interface MapPanelProps {
  data: MapData | null
  activeVehicle: string | null
  onSelectVehicle: (vehicleId: string | null) => void
  onSelectOrder?: (orderId: string) => void
}

function decodePolyline(encoded: string): google.maps.LatLngLiteral[] {
  const points: google.maps.LatLngLiteral[] = []
  let index = 0
  let latitude = 0
  let longitude = 0
  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte: number
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    latitude += (result & 1) ? ~(result >> 1) : result >> 1
    shift = 0
    result = 0
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    longitude += (result & 1) ? ~(result >> 1) : result >> 1
    points.push({ lat: latitude / 1e5, lng: longitude / 1e5 })
  }
  return points
}

function routeCoordinates(route: MapRoute, depot: MapData['depot']): google.maps.LatLngLiteral[] {
  if (!route.encoded_polyline.startsWith('simulated:')) return decodePolyline(route.encoded_polyline)
  return [{ lat: depot.latitude, lng: depot.longitude }, ...route.stops.map((stop) => ({ lat: stop.latitude, lng: stop.longitude })), { lat: depot.latitude, lng: depot.longitude }]
}

function routeToSvg(route: MapRoute, depot: MapData['depot']): { points: string; dots: Array<{ x: number; y: number; orderId?: string }> } {
  const stops = [{ latitude: depot.latitude, longitude: depot.longitude, order_id: 'DEPOT-001' }, ...route.stops]
  const latitudes = stops.map((stop) => stop.latitude)
  const longitudes = stops.map((stop) => stop.longitude)
  const minLat = Math.min(...latitudes) - 0.002
  const maxLat = Math.max(...latitudes) + 0.002
  const minLon = Math.min(...longitudes) - 0.002
  const maxLon = Math.max(...longitudes) + 0.002
  const project = (latitude: number, longitude: number) => ({ x: ((longitude - minLon) / (maxLon - minLon || 1)) * 100, y: (1 - (latitude - minLat) / (maxLat - minLat || 1)) * 100 })
  const dots = stops.map((stop) => ({ ...project(stop.latitude, stop.longitude), orderId: stop.order_id }))
  return { points: dots.map((dot) => `${dot.x},${dot.y}`).join(' '), dots }
}

export function MapPanel({ data, activeVehicle, onSelectVehicle, onSelectOrder }: MapPanelProps) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<Array<google.maps.Marker | google.maps.Polyline>>([])
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [runtimeBrowserKey, setRuntimeBrowserKey] = useState<string | undefined>(
    import.meta.env.VITE_GOOGLE_MAPS_BROWSER_API_KEY || window.__DISPATCH_RUNTIME_CONFIG__?.googleMapsBrowserApiKey,
  )
  useEffect(() => {
    if (runtimeBrowserKey) return
    let cancelled = false
    void fetch('/api/v1/runtime-config')
      .then((response) => (response.ok ? response.json() as Promise<{ google_maps_browser_api_key?: string }> : null))
      .then((config) => {
        if (!cancelled && config?.google_maps_browser_api_key) setRuntimeBrowserKey(config.google_maps_browser_api_key)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [runtimeBrowserKey])
  const browserKey = runtimeBrowserKey
  const visibleRoutes = useMemo(() => data?.routes || [], [data])
  const liveMap = Boolean(browserKey && data?.provider_mode === 'GOOGLE' && data.routes.every((route) => !route.encoded_polyline.startsWith('simulated:')))

  useEffect(() => {
    if (!browserKey || !data || !mapElement.current) return
    let cancelled = false
    const loader = new Loader({ apiKey: browserKey, version: 'weekly' })
    void loader.load().then(() => {
      if (cancelled || !mapElement.current) return
      mapRef.current = new google.maps.Map(mapElement.current, {
        center: { lat: data.depot.latitude, lng: data.depot.longitude },
        zoom: 12,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
      })
      new google.maps.Marker({ map: mapRef.current, position: { lat: data.depot.latitude, lng: data.depot.longitude }, title: 'DEPOT-001 青年局配送中心', label: 'D' })
      infoWindowRef.current = new google.maps.InfoWindow()
      setMapReady(true)
      setMapError(null)
    }).catch(() => setMapError('Google Maps 載入失敗，請檢查 Browser key 與 API 限制。'))
    return () => { cancelled = true; setMapReady(false) }
  }, [browserKey, data])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !data) return
    overlaysRef.current.forEach((overlay) => overlay.setMap(null))
    overlaysRef.current = []
    const bounds = new google.maps.LatLngBounds()
    bounds.extend({ lat: data.depot.latitude, lng: data.depot.longitude })
    visibleRoutes.forEach((route) => {
      const path = routeCoordinates(route, data.depot)
      const selected = !activeVehicle || activeVehicle === route.vehicle_id
      path.forEach((point) => bounds.extend(point))
      const polyline = new google.maps.Polyline({ map: mapRef.current, path, strokeColor: route.color, strokeOpacity: selected ? .95 : .2, strokeWeight: selected ? 4 : 2, zIndex: selected ? 2 : 1 })
      overlaysRef.current.push(polyline)
      route.stops.forEach((stop) => {
        const position = { lat: stop.latitude, lng: stop.longitude }
        bounds.extend(position)
        const marker = new google.maps.Marker({ map: mapRef.current, position, label: String(stop.sequence), title: `${stop.order_id} · ${stop.eta}`, opacity: selected ? 1 : .35 })
        marker.addListener('click', () => {
          if (!infoWindowRef.current || !mapRef.current) return
          infoWindowRef.current.setContent(`<strong>${stop.order_id}</strong><br/>第 ${stop.sequence} 站 · ${stop.eta}`)
          infoWindowRef.current.open({ map: mapRef.current, anchor: marker })
          onSelectVehicle(route.vehicle_id)
          onSelectOrder?.(stop.order_id)
        })
        overlaysRef.current.push(marker)
      })
    })
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 32)
  }, [activeVehicle, data, mapReady, onSelectOrder, onSelectVehicle, visibleRoutes])

  return (
    <section className="panel map-panel" aria-label="配送地圖">
      <div className="panel-heading">
        <div><div className="eyebrow">路線概覽</div><h2>配送地圖</h2><p>{data ? `${data.routes.reduce((sum, route) => sum + route.stops.length, 0)} 個配送站點 · ${data.provider_mode === 'GOOGLE' ? 'Google 路線資料' : '示意路線預覽'}` : '請先匯入並建立方案'}</p></div>
        {data && <div className="route-filter"><button className={`filter-pill ${!activeVehicle ? 'active' : ''}`} onClick={() => onSelectVehicle(null)}>全部</button>{data.routes.map((route) => <button className={`filter-pill ${activeVehicle === route.vehicle_id ? 'active' : ''}`} key={route.vehicle_id} onClick={() => onSelectVehicle(route.vehicle_id)}>{route.vehicle_id}</button>)}</div>}
      </div>
      <div className="map-wrap">
        {liveMap && <div className="map-canvas" ref={mapElement} />}
        {!liveMap && <div className="map-fallback"><div className="map-grid" />{data && visibleRoutes.map((route) => { const svg = routeToSvg(route, data.depot); const selected = !activeVehicle || activeVehicle === route.vehicle_id; return <svg className="map-route" style={{ opacity: selected ? 1 : .2 }} viewBox="0 0 100 100" preserveAspectRatio="none" key={route.vehicle_id}><polyline points={svg.points} stroke={route.color} />{svg.dots.map((dot, index) => <circle key={`${route.vehicle_id}-${index}`} cx={dot.x} cy={dot.y} r={index === 0 ? 2 : 1.4} fill={index === 0 ? '#fff' : route.color} onClick={() => { if (dot.orderId) { onSelectVehicle(route.vehicle_id); if (dot.orderId !== 'DEPOT-001') onSelectOrder?.(dot.orderId) } }} />)}</svg>})}</div>}
        <div className="map-label"><strong>DEPOT-001</strong><span>新北市青年局配送中心</span></div>
        <div className={`map-status ${liveMap && !mapError ? 'is-live' : ''}`}>{liveMap && !mapError ? 'Google Maps · 即時道路' : browserKey ? '示意路線 · Google 路線資料不可用' : '示意路線 · Browser key 未設定'}</div>
        {mapError && <div className="warning-box" style={{ position: 'absolute', left: 16, right: 16, top: 58 }}>{mapError}</div>}
        {!data && <div className="loading">等待配送方案</div>}
        {data && <div className="map-legend">{data.routes.map((route) => <span className="legend-item" key={route.vehicle_id}><i className="legend-dot" style={{ background: route.color }} />{route.vehicle_id}</span>)}{data.traffic?.data_status === 'EVENTS_FOUND' && <span className="legend-item">⚠ TDX 路況事件</span>}</div>}
      </div>
    </section>
  )
}
