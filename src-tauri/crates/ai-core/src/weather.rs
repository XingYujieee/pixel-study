//! 天气跟随现实：用 Open-Meteo（免费、无需密钥）查城市坐标与当前天气。
//! 只发送用户选择的城市名或经纬度，不带任何笔记内容。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub name: String,
    /// 省 / 州、国家，便于区分同名城市
    pub detail: String,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Now {
    /// clear / cloudy / rain / snow / storm
    pub weather: String,
    pub temperature: f64,
    pub is_day: bool,
    pub code: i64,
}

/// WMO 天气代码 → 书房的五种天气
pub fn map_code(code: i64) -> &'static str {
    match code {
        0 | 1 => "clear",
        2 | 3 | 45 | 48 => "cloudy",
        51..=67 | 80..=82 => "rain",
        71..=77 | 85 | 86 => "snow",
        95..=99 => "storm",
        _ => "cloudy",
    }
}

#[derive(Deserialize)]
struct GeoResp {
    #[serde(default)]
    results: Vec<GeoItem>,
}

#[derive(Deserialize)]
struct GeoItem {
    name: String,
    latitude: f64,
    longitude: f64,
    #[serde(default)]
    admin1: Option<String>,
    #[serde(default)]
    country: Option<String>,
}

pub fn parse_places(json: &str) -> Result<Vec<Place>, String> {
    let r: GeoResp = serde_json::from_str(json).map_err(|e| format!("地点数据格式不对：{e}"))?;
    Ok(r
        .results
        .into_iter()
        .map(|g| Place {
            name: g.name,
            detail: [g.admin1, g.country].into_iter().flatten().collect::<Vec<_>>().join("，"),
            lat: g.latitude,
            lon: g.longitude,
        })
        .collect())
}

#[derive(Deserialize)]
struct ForecastResp {
    current: Current,
}

#[derive(Deserialize)]
struct Current {
    weather_code: i64,
    temperature_2m: f64,
    #[serde(default)]
    is_day: i64,
}

pub fn parse_now(json: &str) -> Result<Now, String> {
    let r: ForecastResp = serde_json::from_str(json).map_err(|e| format!("天气数据格式不对：{e}"))?;
    Ok(Now {
        weather: map_code(r.current.weather_code).to_string(),
        temperature: r.current.temperature_2m,
        is_day: r.current.is_day == 1,
        code: r.current.weather_code,
    })
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent("PixelStudy/1.0")
        .build()
        .map_err(|e| e.to_string())
}

pub async fn search_places(query: &str) -> Result<Vec<Place>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let resp = client()?
        .get("https://geocoding-api.open-meteo.com/v1/search")
        .query(&[("name", q), ("count", "8"), ("language", "zh"), ("format", "json")])
        .send()
        .await
        .map_err(|e| format!("连不上天气服务：{e}"))?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    parse_places(&text)
}

pub async fn current(lat: f64, lon: f64) -> Result<Now, String> {
    if !(lat.abs() <= 90.0 && lon.abs() <= 180.0) {
        return Err("坐标不对".into());
    }
    let resp = client()?
        .get("https://api.open-meteo.com/v1/forecast")
        .query(&[
            ("latitude", format!("{lat:.3}")),
            ("longitude", format!("{lon:.3}")),
            ("current", "weather_code,temperature_2m,is_day".to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("连不上天气服务：{e}"))?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    parse_now(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_wmo_codes() {
        assert_eq!(map_code(0), "clear");
        assert_eq!(map_code(3), "cloudy");
        assert_eq!(map_code(61), "rain");
        assert_eq!(map_code(81), "rain");
        assert_eq!(map_code(73), "snow");
        assert_eq!(map_code(95), "storm");
        assert_eq!(map_code(1234), "cloudy");
    }

    #[test]
    fn parses_responses() {
        let g = r#"{"results":[{"name":"伦敦","latitude":51.5085,"longitude":-0.1257,"admin1":"英格兰","country":"英国"},{"name":"London","latitude":42.98,"longitude":-81.23,"country":"加拿大"}]}"#;
        let p = parse_places(g).unwrap();
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].detail, "英格兰，英国");
        assert_eq!(p[1].detail, "加拿大");
        assert!(parse_places("{}").unwrap().is_empty());
        let f = r#"{"latitude":51.5,"current":{"time":"2026-10-06T00:00","weather_code":63,"temperature_2m":11.4,"is_day":0}}"#;
        assert_eq!(parse_now(f).unwrap(), Now { weather: "rain".into(), temperature: 11.4, is_day: false, code: 63 });
        assert!(parse_now("{\"error\":true}").is_err());
    }
}
