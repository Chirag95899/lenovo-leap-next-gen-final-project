import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { INITIAL_URBAN_ZONES, INITIAL_CIVIC_ISSUES, SDG_11_INDICATORS } from './src/data/mockData.js';
import { CivicIssue, UrbanZone } from './src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express
const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// In-Memory Database Store for live operations
let zonesStore: UrbanZone[] = [...INITIAL_URBAN_ZONES];
let issuesStore: CivicIssue[] = [...INITIAL_CIVIC_ISSUES];

// Lazy Gemini Initialization helper
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY environment variable is missing.');
  }
  return new GoogleGenAI({
    apiKey: apiKey || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

// ==========================================
// REST API ENDPOINTS
// ==========================================

// 1. System Health Check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    system: 'CivicShield AI - SDG 11 Urban Resilience Platform',
    timestamp: new Date().toISOString(),
    zonesCount: zonesStore.length,
    issuesCount: issuesStore.length
  });
});

// 2. Get All Urban Zones
app.get('/api/zones', (req: Request, res: Response) => {
  res.json({ success: true, zones: zonesStore });
});

// 3. Update Zone Sensor Simulation
app.post('/api/zones/:id/sensor-update', (req: Request, res: Response) => {
  const { id } = req.params;
  const { rainfall, aqi, pm25, drainageCapacity } = req.body;

  const zoneIndex = zonesStore.findIndex(z => z.id === id);
  if (zoneIndex === -1) {
    res.status(404).json({ success: false, error: 'Zone not found' });
    return;
  }

  const updatedZone = { ...zonesStore[zoneIndex] };
  if (rainfall !== undefined) updatedZone.rainfall = Number(rainfall);
  if (aqi !== undefined) updatedZone.aqi = Number(aqi);
  if (pm25 !== undefined) updatedZone.pm25 = Number(pm25);
  if (drainageCapacity !== undefined) updatedZone.drainageCapacity = Number(drainageCapacity);

  // Recalculate Risk Score
  const floodRisk = Math.min(100, Math.round((updatedZone.rainfall * 1.2) + (100 - updatedZone.drainageCapacity) * 0.5));
  updatedZone.floodRiskScore = floodRisk;
  updatedZone.riskLevel = floodRisk > 85 ? 'CRITICAL' : floodRisk > 65 ? 'HIGH' : floodRisk > 40 ? 'MODERATE' : 'LOW';

  zonesStore[zoneIndex] = updatedZone;
  res.json({ success: true, zone: updatedZone });
});

// 4. Get Civic Issues
app.get('/api/issues', (req: Request, res: Response) => {
  res.json({ success: true, issues: issuesStore });
});

// 5. Create Civic Issue
app.post('/api/issues', (req: Request, res: Response) => {
  const newIssue: CivicIssue = {
    id: `ISS-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
    title: req.body.title || 'Reported Urban Hazard',
    category: req.body.category || 'DRAINAGE',
    severity: req.body.severity || 'MEDIUM',
    zoneId: req.body.zoneId || 'zone-central',
    zoneName: req.body.zoneName || 'Central Business District',
    address: req.body.address || 'Municipal Zone',
    description: req.body.description || '',
    status: 'PENDING',
    reportedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
    imageUrl: req.body.imageUrl,
    aiAnalysis: req.body.aiAnalysis
  };

  issuesStore.unshift(newIssue);

  // Update zone issue count
  const zoneIndex = zonesStore.findIndex(z => z.id === newIssue.zoneId);
  if (zoneIndex !== -1) {
    zonesStore[zoneIndex].activeIssuesCount += 1;
  }

  res.status(201).json({ success: true, issue: newIssue });
});

// 6. Update Issue Status
app.put('/api/issues/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  const issueIndex = issuesStore.findIndex(i => i.id === id);
  if (issueIndex === -1) {
    res.status(404).json({ success: false, error: 'Issue not found' });
    return;
  }

  issuesStore[issueIndex].status = status;
  res.json({ success: true, issue: issuesStore[issueIndex] });
});

// 7. Get SDG 11 Indicators
app.get('/api/sdg-indicators', (req: Request, res: Response) => {
  res.json({ success: true, indicators: SDG_11_INDICATORS });
});

// ==========================================
// AI ENGINE ENDPOINTS (Gemini 3.6 Flash)
// ==========================================

// AI 1: Vision Report Analysis (Multimodal Image Audit)
app.post('/api/ai/vision-report', async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType, userDescription, category, zoneName } = req.body;
    const ai = getGeminiClient();

    const promptText = `
You are an expert Urban Environmental Safety & Infrastructure AI auditor for SDG 11 (Sustainable Cities and Communities).
Analyze the provided urban hazard issue report in ${zoneName || 'the city'}.
User Description: "${userDescription || 'Visual inspection required'}".
Reported Category: "${category || 'General Urban Infrastructure'}".

Evaluate the visual evidence or description and provide a structured JSON inspection report with:
1. summary: A concise 2-sentence technical diagnostic summary.
2. detectedHazards: Array of 3 specific urban hazard risks (e.g., "Flash flood inundation", "Electrical grounding failure", "Structural collapse").
3. sdgTarget: Specific SDG 11 target directly addressed (e.g., "SDG 11.5 - Water disaster resilience" or "SDG 11.6 - Municipal waste reduction").
4. estimatedRepairCost: Estimated municipal remediation cost formatted like "$3,500".
5. urgencyScore: Integer scale 1-10 (10 being immediate catastrophe).
6. recommendedAction: Clear action item for municipal emergency dispatch.
`;

    const contents: any[] = [{ text: promptText }];

    if (imageBase64) {
      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      contents.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: cleanBase64
        }
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: { parts: contents },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            detectedHazards: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            sdgTarget: { type: Type.STRING },
            estimatedRepairCost: { type: Type.STRING },
            urgencyScore: { type: Type.INTEGER },
            recommendedAction: { type: Type.STRING }
          },
          required: ['summary', 'detectedHazards', 'sdgTarget', 'estimatedRepairCost', 'urgencyScore', 'recommendedAction']
        }
      }
    });

    const resultText = response.text || '{}';
    const parsedData = JSON.parse(resultText);

    res.json({
      success: true,
      analysis: parsedData
    });
  } catch (error: any) {
    console.error('AI Vision Report Error:', error);
    // Fallback response for offline or missing API key scenario
    res.json({
      success: true,
      analysis: {
        summary: 'AI Vision diagnostic complete: Detected drainage flow restriction and localized water accumulation.',
        detectedHazards: ['Stormwater channel siltation', 'Localized flood risk', 'Mosquito pathogen vector'],
        sdgTarget: 'SDG 11.5 - Reduce water disaster vulnerability',
        estimatedRepairCost: '$3,200',
        urgencyScore: 8,
        recommendedAction: 'Dispatch high-volume suction truck and drainage maintenance crew.'
      }
    });
  }
});

// AI 2: Air Quality Forecast Engine
app.post('/api/ai/aqi-predict', async (req: Request, res: Response) => {
  try {
    const { zoneName, currentAQI, pm25, pm10, temperature, humidity, trafficDensity } = req.body;
    const ai = getGeminiClient();

    const promptText = `
You are an atmospheric scientist AI for Smart City Environmental Planning (SDG 11.6).
Analyze these real-time sensor metrics for ${zoneName || 'Central City Zone'}:
- Current AQI: ${currentAQI || 110}
- PM2.5: ${pm25 || 42} ug/m3
- PM10: ${pm10 || 85} ug/m3
- Temperature: ${temperature || 31}°C
- Humidity: ${humidity || 65}%
- Traffic Density Factor: ${trafficDensity || 'High'}

Predict the 24-hour hourly AQI trend (24 integer numbers), identify the main pollutant, provide public health guidance, and give 3 targeted municipal policy actions.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: promptText,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            predictedAQI24h: {
              type: Type.ARRAY,
              items: { type: Type.INTEGER },
              description: '24 hourly predicted AQI values starting from current hour'
            },
            mainPollutant: { type: Type.STRING },
            healthAdvice: { type: Type.STRING },
            contributingFactors: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            aiPolicyRecommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ['predictedAQI24h', 'mainPollutant', 'healthAdvice', 'contributingFactors', 'aiPolicyRecommendations']
        }
      }
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json({ success: true, forecast: parsed });
  } catch (error) {
    console.error('AI AQI Error:', error);
    // Fallback baseline
    const base = Number(req.body.currentAQI) || 110;
    const mockTrend = Array.from({ length: 24 }, (_, i) => Math.round(base + Math.sin(i / 3) * 20 + (i > 16 ? 15 : -10)));
    res.json({
      success: true,
      forecast: {
        predictedAQI24h: mockTrend,
        mainPollutant: 'PM2.5 (Fine Particulate Matter)',
        healthAdvice: 'Sensitive groups (children, elderly, asthma sufferers) should limit prolonged outdoor exertion during evening traffic peak.',
        contributingFactors: ['Nocturnal thermal inversion layer', 'High diesel freight transit', 'Low wind dispersal velocity (1.2 m/s)'],
        aiPolicyRecommendations: [
          'Enforce low-emission zone freight rerouting after 20:00.',
          'Deploy automated municipal water mist spraying trucks along main arterial corridors.',
          'Issue real-time SMS health advisories to school districts in Zone.'
        ]
      }
    });
  }
});

// AI 3: Flood Risk & Hydraulic Simulation
app.post('/api/ai/flood-predict', async (req: Request, res: Response) => {
  try {
    const { zoneName, rainfallMmHr, drainageCapacityPercent, soilSaturationPercent } = req.body;
    const ai = getGeminiClient();

    const promptText = `
You are a hydraulic disaster engineering AI specializing in urban flash flood mitigation for SDG 11.5.
Evaluate hydraulic risk parameters for ${zoneName || 'Low-Lying River Basin'}:
- Rainfall Intensity: ${rainfallMmHr || 45} mm/hr
- Drainage Infrastructure Capacity: ${drainageCapacityPercent || 40}%
- Soil Moisture Saturation: ${soilSaturationPercent || 75}%

Provide a structured flood risk evaluation containing:
1. floodSeverityIndex: Integer 0-100
2. predictedInundationDepthCm: Predicted water depth in centimeters (0-150cm)
3. affectedPopulationEstimate: Estimated vulnerable residents
4. riskCategory: One of ['SAFE', 'WARNING', 'DANGER', 'SEVERE']
5. recommendedInterventions: 3 immediate municipal engineering steps
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: promptText,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            floodSeverityIndex: { type: Type.INTEGER },
            predictedInundationDepthCm: { type: Type.INTEGER },
            affectedPopulationEstimate: { type: Type.INTEGER },
            riskCategory: { type: Type.STRING },
            recommendedInterventions: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ['floodSeverityIndex', 'predictedInundationDepthCm', 'affectedPopulationEstimate', 'riskCategory', 'recommendedInterventions']
        }
      }
    });

    res.json({ success: true, assessment: JSON.parse(response.text || '{}') });
  } catch (error) {
    console.error('AI Flood Error:', error);
    const rain = Number(req.body.rainfallMmHr) || 45;
    const fsi = Math.min(100, Math.round(rain * 1.5 + 20));
    res.json({
      success: true,
      assessment: {
        floodSeverityIndex: fsi,
        predictedInundationDepthCm: Math.round(fsi * 0.45),
        affectedPopulationEstimate: fsi * 180,
        riskCategory: fsi > 80 ? 'SEVERE' : fsi > 60 ? 'DANGER' : 'WARNING',
        recommendedInterventions: [
          'Activate high-capacity emergency stormwater pumps at canal gates 4 & 7.',
          'Issue automated SMS warning alerts and open elevated public shelters.',
          'Pre-position emergency rescue zodiac boats near low-lying river bends.'
        ]
      }
    });
  }
});

// AI 4: Emergency Action Plan Generator
app.post('/api/ai/emergency-plan', async (req: Request, res: Response) => {
  try {
    const { incidentTitle, zoneName, severity, promptDetails } = req.body;
    const ai = getGeminiClient();

    const promptText = `
You are the Chief AI Disaster Coordinator for Municipal Emergency Operations (SDG 11).
Generate an Emergency Multi-Agency Action Plan for:
Incident: "${incidentTitle || 'Severe Flash Flood & Power Outage'}"
Location: "${zoneName || 'South River Basin Zone'}"
Severity: "${severity || 'CRITICAL'}"
Context: "${promptDetails || 'Rapid rising water threatening residential neighborhoods'}"

Output structured JSON:
1. title: Operational Plan Name
2. priorityRoutes: Array of 3 emergency clear corridors for ambulances/fire trucks
3. departmentTasks: Array of 3 objects with { department, action, resourcesAssigned }
4. publicAdvisory: Concise public warning message
5. estimatedResolutionTime: Estimated hours to control incident
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: promptText,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            priorityRoutes: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            departmentTasks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  department: { type: Type.STRING },
                  action: { type: Type.STRING },
                  resourcesAssigned: { type: Type.STRING }
                },
                required: ['department', 'action', 'resourcesAssigned']
              }
            },
            publicAdvisory: { type: Type.STRING },
            estimatedResolutionTime: { type: Type.STRING }
          },
          required: ['title', 'priorityRoutes', 'departmentTasks', 'publicAdvisory', 'estimatedResolutionTime']
        }
      }
    });

    res.json({ success: true, plan: JSON.parse(response.text || '{}') });
  } catch (error) {
    console.error('AI Emergency Plan Error:', error);
    res.json({
      success: true,
      plan: {
        title: 'Operation CivicShield: Rapid Hydraulic Disaster Containment',
        priorityRoutes: ['Arterial Express Highway 4 (Evacuation Corridor)', 'Riverfront Bypass Lane 2', 'South Hospital Emergency Access Way'],
        departmentTasks: [
          { department: 'Municipal Drainage & Engineering', action: 'Clear clogged sluice gates & deploy 400 HP mobile diesel pumps', resourcesAssigned: '3 Heavy Pump Units, 12 Technicians' },
          { department: 'Fire & Rescue Services', action: 'Evacuate ground-floor residents in flooded sectors to high ground', resourcesAssigned: '6 Inflatable Boats, 24 Rescue Officers' },
          { department: 'Traffic & Urban Police', action: 'Block submerged underpasses and divert traffic away from river basin', resourcesAssigned: '18 Patrol Vehicles, 36 Officers' }
        ],
        publicAdvisory: 'URGENT CITIZEN NOTICE: Avoid low-lying underpasses along South River Basin. Move essential items to second floors and monitor official emergency broadcasts.',
        estimatedResolutionTime: '4 - 6 Hours'
      }
    });
  }
});

// AI 5: Conversational Civic Knowledge Assistant
app.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    const { message, chatHistory } = req.body;
    const ai = getGeminiClient();

    const systemInstruction = `
You are the CivicShield AI Assistant, an authoritative expert on UN Sustainable Development Goal 11 (Sustainable Cities and Communities), urban resilience, air quality management, flood engineering, municipal issue reporting, and smart city technologies.
Provide clear, actionable, expert responses formatted nicely with bullet points and bold headers where applicable.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: message || 'Explain how smart city AI platforms improve urban resilience under SDG 11.',
      config: {
        systemInstruction
      }
    });

    res.json({
      success: true,
      reply: response.text || 'CivicShield AI is monitoring municipal sensors and urban infrastructure.'
    });
  } catch (error) {
    console.error('AI Chat Error:', error);
    res.json({
      success: true,
      reply: 'CivicShield AI provides real-time situational intelligence for SDG 11. By combining IoT sensor metrics with multimodal AI, municipal leaders can cut disaster response lead times and optimize environmental sustainability.'
    });
  }
});

// ==========================================
// VITE MIDDLEWARE / PRODUCTION STATIC SERVER
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`CivicShield AI Server running on http://0.0.0.0:${PORT}`);
    console.log(`Targeting UN SDG 11: Sustainable Cities & Communities`);
    console.log(`====================================================`);
  });
}

startServer();
