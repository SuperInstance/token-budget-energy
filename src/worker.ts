interface Env {
    FLEET_ENERGY: KVNamespace;
}

interface Allocation {
    vessel: string;
    credits: number;
    timestamp: number;
}

interface LedgerEntry {
    vessel: string;
    action: 'allocate' | 'consume' | 'transfer';
    amount: number;
    timestamp: number;
    metadata?: Record<string, any>;
}

const FLEET_KEY = 'fleet_energy';
const LEDGER_KEY = 'energy_ledger';
const DEFAULT_ENERGY = 1000;
const MAX_LEDGER_ENTRIES = 100;

async function getFleetEnergy(env: Env): Promise<number> {
    const energy = await env.FLEET_ENERGY.get(FLEET_KEY);
    return energy ? parseInt(energy) : DEFAULT_ENERGY;
}

async function updateFleetEnergy(env: Env, delta: number): Promise<number> {
    const current = await getFleetEnergy(env);
    const updated = Math.max(0, current + delta);
    await env.FLEET_ENERGY.put(FLEET_KEY, updated.toString());
    return updated;
}

async function getVesselBudget(env: Env, vessel: string): Promise<number> {
    const budget = await env.FLEET_ENERGY.get(`vessel:${vessel}`);
    return budget ? parseInt(budget) : 0;
}

async function updateVesselBudget(env: Env, vessel: string, delta: number): Promise<number> {
    const current = await getVesselBudget(env, vessel);
    const updated = Math.max(0, current + delta);
    await env.FLEET_ENERGY.put(`vessel:${vessel}`, updated.toString());
    return updated;
}

async function addLedgerEntry(env: Env, entry: LedgerEntry): Promise<void> {
    const ledgerStr = await env.FLEET_ENERGY.get(LEDGER_KEY);
    let ledger: LedgerEntry[] = ledgerStr ? JSON.parse(ledgerStr) : [];
    
    ledger.unshift(entry);
    if (ledger.length > MAX_LEDGER_ENTRIES) {
        ledger = ledger.slice(0, MAX_LEDGER_ENTRIES);
    }
    
    await env.FLEET_ENERGY.put(LEDGER_KEY, JSON.stringify(ledger));
}

async function handleAllocate(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }
    
    try {
        const allocation: Allocation = await request.json();
        
        if (!allocation.vessel || typeof allocation.credits !== 'number') {
            return new Response(JSON.stringify({ error: 'Invalid allocation data' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const fleetEnergy = await getFleetEnergy(env);
        
        if (allocation.credits > fleetEnergy) {
            return new Response(JSON.stringify({ 
                error: 'Insufficient fleet energy', 
                available: fleetEnergy 
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        await updateFleetEnergy(env, -allocation.credits);
        const newBudget = await updateVesselBudget(env, allocation.vessel, allocation.credits);
        
        await addLedgerEntry(env, {
            vessel: allocation.vessel,
            action: 'allocate',
            amount: allocation.credits,
            timestamp: Date.now(),
            metadata: { source: 'api' }
        });
        
        return new Response(JSON.stringify({
            success: true,
            vessel: allocation.vessel,
            allocated: allocation.credits,
            newBudget,
            remainingFleetEnergy: fleetEnergy - allocation.credits
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function handleGetBudget(request: Request, env: Env, vessel: string): Promise<Response> {
    const budget = await getVesselBudget(env, vessel);
    const fleetEnergy = await getFleetEnergy(env);
    
    return new Response(JSON.stringify({
        vessel,
        budget,
        fleetEnergy,
        throttlingLevel: calculateThrottlingLevel(budget)
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleGetLedger(request: Request, env: Env): Promise<Response> {
    const ledgerStr = await env.FLEET_ENERGY.get(LEDGER_KEY);
    const ledger: LedgerEntry[] = ledgerStr ? JSON.parse(ledgerStr) : [];
    const fleetEnergy = await getFleetEnergy(env);
    
    return new Response(JSON.stringify({
        ledger,
        fleetEnergy,
        totalEntries: ledger.length
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

function calculateThrottlingLevel(budget: number): string {
    if (budget <= 0) return 'critical';
    if (budget < 100) return 'high';
    if (budget < 500) return 'medium';
    if (budget < 1000) return 'low';
    return 'normal';
}

function handleHealth(): Response {
    return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

function handleRoot(): Response {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Token Budget Energy — Fleet Resource Management</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: #0a0a0f;
            color: #e5e7eb;
            line-height: 1.6;
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 1px solid #1f2937;
        }
        
        h1 {
            font-size: 2.5rem;
            font-weight: 700;
            background: linear-gradient(135deg, #eab308 0%, #fbbf24 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
        }
        
        .subtitle {
            font-size: 1.1rem;
            color: #9ca3af;
            max-width: 600px;
            margin: 0 auto;
        }
        
        .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 24px;
            margin-bottom: 40px;
        }
        
        .card {
            background: #111827;
            border-radius: 12px;
            padding: 24px;
            border: 1px solid #1f2937;
            transition: transform 0.2s, border-color 0.2s;
        }
        
        .card:hover {
            transform: translateY(-2px);
            border-color: #374151;
        }
        
        .card h2 {
            font-size: 1.25rem;
            font-weight: 600;
            color: #eab308;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .card h2::before {
            content: '';
            width: 8px;
            height: 8px;
            background: #eab308;
            border-radius: 50%;
        }
        
        .endpoint {
            background: #1f2937;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 12px;
            border-left: 4px solid #eab308;
        }
        
        .method {
            display: inline-block;
            padding: 4px 12px;
            background: #eab308;
            color: #0a0a0f;
            border-radius: 4px;
            font-weight: 600;
            font-size: 0.875rem;
            margin-right: 12px;
        }
        
        .path {
            font-family: 'Monaco', 'Consolas', monospace;
            color: #60a5fa;
        }
        
        .description {
            margin-top: 8px;
            color: #9ca3af;
            font-size: 0.875rem;
        }
        
        .example {
            background: #1f2937;
            border-radius: 6px;
            padding: 12px;
            margin-top: 12px;
            font-family: 'Monaco', 'Consolas', monospace;
            font-size: 0.875rem;
            overflow-x: auto;
        }
        
        footer {
            text-align: center;
            margin-top: 60px;
            padding-top: 20px;
            border-top: 1px solid #1f2937;
            color: #6b7280;
            font-size: 0.875rem;
        }
        
        .fleet-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: #1f2937;
            padding: 8px 16px;
            border-radius: 20px;
            margin-top: 12px;
        }
        
        .pulse {
            width: 8px;
            height: 8px;
            background: #10b981;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }
            
            h1 {
                font-size: 2rem;
            }
            
            .dashboard {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Token Budget Energy</h1>
            <p class="subtitle">Fleet-wide resource management system. Vessels self-throttle based on shared energy credits.</p>
        </header>
        
        <div class="dashboard">
            <div class="card">
                <h2>API Endpoints</h2>
                
                <div class="endpoint">
                    <span class="method">POST</span>
                    <span class="path">/api/allocate</span>
                    <div class="description">Allocate energy credits to a vessel</div>
                    <div class="example">
                        {<br>
                        &nbsp;&nbsp;"vessel": "explorer-1",<br>
                        &nbsp;&nbsp;"credits": 100<br>
                        }
                    </div>
                </div>
                
                <div class="endpoint">
                    <span class="method">GET</span>
                    <span class="path">/api/budget/:vessel</span>
                    <div class="description">Check vessel budget and throttling level</div>
                </div>
                
                <div class="endpoint">
                    <span class="method">GET</span>
                    <span class="path">/api/ledger</span>
                    <div class="description">View fleet transaction ledger</div>
                </div>
                
                <div class="endpoint">
                    <span class="method">GET</span>
                    <span class="path">/health</span>
                    <div class="description">Health check endpoint</div>
                </div>
            </div>
            
            <div class="card">
                <h2>Features</h2>
                <ul style="list-style: none; padding-left: 0;">
                    <li style="margin-bottom: 12px; padding-left: 20px; position: relative;">
                        <span style="position: absolute; left: 0; color: #eab308;">•</span>
                        Per-vessel energy allocation
                    </li>
                    <li style="margin-bottom: 12px; padding-left: 20px; position: relative;">
                        <span style="position: absolute; left: 0; color: #eab308;">•</span>
                        Fleet-wide credit ledger
                    </li>
                    <li style="margin-bottom: 12px; padding-left: 20px; position: relative;">
                        <span style="position: absolute; left: 0; color: #eab308;">•</span>
                        Adaptive throttling
                    </li>
                    <li style="margin-bottom: 12px; padding-left: 20px; position: relative;">
                        <span style="position: absolute; left: 0; color: #eab308;">•</span>
                        Marketplace integration ready
                    </li>
                    <li style="margin-bottom: 12px; padding-left: 20px; position: relative;">
                        <span style="position: absolute; left: 0; color: #eab308;">•</span>
                        Real-time energy monitoring
                    </li>
                </ul>
            </div>
            
            <div class="card">
                <h2>Throttling Levels</h2>
                <div style="display: grid; gap: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #1f2937; border-radius: 6px;">
                        <span>Normal</span>
                        <span style="color: #10b981;">≥ 1000 credits</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #1f2937; border-radius: 6px;">
                        <span>Low</span>
                        <span style="color: #f59e0b;">500-999 credits</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #1f2937; border-radius: 6px;">
                        <span>Medium</span>
                        <span style="color: #f97316;">100-499 credits</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #1f2937; border-radius: 6px;">
                        <span>High</span>
                        <span style="color: #ef4444;">1-99 credits</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #1f2937; border-radius: 6px;">
                        <span>Critical</span>
                        <span style="color: #dc2626;">0 credits</span>
                    </div>
                </div>
            </div>
        </div>
        
        <footer>
            <p>Token Budget Energy System — Fleet Resource Management</p>
            <div class="fleet-badge">
                <div class="pulse"></div>
                <span>Fleet Status: Operational</span>
            </div>
        </footer>
    </div>
</body>
</html>`;
    
    return new Response(html, {
        headers: {
            'Content-Type': 'text/html',
            'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'",
            'X-Frame-Options': 'DENY'
        }
    });
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;
        
        if (path === '/' || path === '/index.html') {
            return handleRoot();
        }
        
        if (path === '/health') {
            return handleHealth();
        }
        
        if (path === '/api/allocate') {
            return handleAllocate(request, env);
        }
        
        if (path.startsWith('/api/budget/')) {
            const vessel = path.split('/').pop();
            if (vessel) {
                return handleGetBudget(request, env, vessel);
            }
        }
        
        if (path === '/api/ledger') {
            return handleGetLedger(request, env);
        }
        
        return new Response('Not found', { status: 404 });
    }
};