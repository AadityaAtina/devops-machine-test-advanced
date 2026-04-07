# Debugging Explanation: App Instability After Scaling to 5 Pods

## Problem Statement

After scaling the microservices deployment to **5 pods**, the application becomes unstable. Symptoms include:
- Intermittent 502/503 errors from the Ingress
- Pods entering `CrashLoopBackOff` or `OOMKilled` state
- Increased response latency
- Database connection errors in logs

---

## Root Cause Analysis

### 1. Database Connection Pool Exhaustion (Primary Cause)

**What happens:** Each pod maintains its own connection pool to MySQL. With 5 pods each opening 10 connections, the total becomes 50 connections. MySQL's default `max_connections` is often set to 25-50 on small instances, causing connection refused errors.

**Evidence:**
```
Error: ER_CON_COUNT_ERROR: Too many connections
```

**Fix Applied:**
```javascript
// Before (in server.js)
const pool = mysql.createPool({
  connectionLimit: 10,  // per pod = 50 total at 5 pods
  host: process.env.DB_HOST
});

// After
const pool = mysql.createPool({
  connectionLimit: 3,   // per pod = 15 total at 5 pods - safe margin
  host: process.env.DB_HOST,
  waitForConnections: true,
  queueLimit: 0
});
```

Alternatively, deploy **ProxySQL** or **Azure Database for MySQL Flexible Server** which supports connection pooling natively.

---

### 2. Missing Resource Limits Causing OOMKilled

**What happens:** Without CPU/memory limits, pods compete for node resources. Under load with 5 pods, nodes run out of memory and Kubernetes kills pods.

**Evidence:**
```bash
kubectl describe pod <pod-name> -n microservices
# Shows: OOMKilled, Exit Code 137
```

**Fix Applied** (in `k8s/deployment.yaml`):
```yaml
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "200m"
```

---

### 3. HPA Misconfiguration — Scaling Too Aggressively

**What happens:** Without proper `stabilizationWindowSeconds`, the HPA scales up and down rapidly (thrashing), creating a wave of new pods all trying to connect to the DB simultaneously.

**Fix Applied** (in `k8s/hpa.yaml`):
```yaml
behavior:
  scaleUp:
    stabilizationWindowSeconds: 60
    policies:
    - type: Pods
      value: 2
      periodSeconds: 60
  scaleDown:
    stabilizationWindowSeconds: 120
```

---

### 4. Missing Readiness Probes — Traffic Sent to Unready Pods

**What happens:** When new pods start, they're added to the Service endpoint before they finish initializing (DB connection, env var loading). Requests are routed to them and fail.

**Fix Applied** (in `k8s/deployment.yaml`):
```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 3
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3
```

Each service exposes `GET /health` returning `{ status: 'ok' }`.

---

### 5. Secret/Key Vault Access Race Condition

**What happens:** When 5 pods start simultaneously, all try to fetch secrets from Azure Key Vault at the same time. Key Vault throttles requests (429 Too Many Requests), causing some pods to start with missing environment variables.

**Fix Applied:**
- Added exponential backoff retry in the Key Vault SDK configuration
- Set `initialDelaySeconds: 15` on readiness probe to allow secret fetch to complete
- Used **Managed Identity** + **CSI Secret Store Driver** to mount secrets as files instead of environment variables fetched at runtime

---

## Debugging Commands Used

```bash
# Check pod status
kubectl get pods -n microservices

# Check pod logs
kubectl logs <pod-name> -n microservices --previous

# Describe pod for events
kubectl describe pod <pod-name> -n microservices

# Check HPA status
kubectl get hpa -n microservices

# Check resource usage
kubectl top pods -n microservices
kubectl top nodes

# Check MySQL connections
mysql -h $DB_HOST -u $DB_USER -p -e "SHOW STATUS LIKE 'Threads_connected';"
mysql -h $DB_HOST -u $DB_USER -p -e "SHOW VARIABLES LIKE 'max_connections';"

# Check events
kubectl get events -n microservices --sort-by='.lastTimestamp'
```

---

## Summary of Fixes

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| DB connection errors | Connection pool too large per pod | Reduced `connectionLimit` to 3 per pod |
| OOMKilled pods | No memory limits | Added resource limits/requests in deployment.yaml |
| HPA thrashing | No stabilization window | Added `stabilizationWindowSeconds` to HPA |
| 502 errors during scale-up | No readiness probe | Added `/health` readiness + liveness probes |
| Missing env vars at startup | Key Vault throttling | Used CSI driver + increased initialDelaySeconds |

---

## Prevention for Future Scaling

1. **Load test before scaling** using `k6` or `locust` to identify bottlenecks
2. **Set MySQL `max_connections`** = (max_pods * connectionLimit) + 20% buffer
3. **Use PodDisruptionBudgets** to ensure minimum healthy pods during rolling updates
4. **Enable Azure Monitor** alerts for pod restarts and CPU/memory thresholds (see `monitoring/alert-rules.json`)
5. **Use ProxySQL** or **PgBouncer** for database connection pooling at the infrastructure level
