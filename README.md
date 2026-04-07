# DevOps Machine Test — Advanced Microservices Deployment on Azure

## Difficulty: Senior / Advanced

## Objective

Design and deploy a **production-grade microservices application** on Microsoft Azure using AKS, Terraform, Docker, and Azure DevOps CI/CD pipelines. You must handle inter-service communication, independent scaling, secrets management, monitoring, and a real-world debugging scenario.

---

## Architecture Overview

The application consists of **4 microservices**:

| Service | Language | Port | Responsibility |
|---|---|---|---|
| `auth-service` | Node.js | 4001 | JWT-based user authentication |
| `order-service` | Node.js | 4002 | Create and list orders (calls auth-service to verify tokens) |
| `payment-service` | Node.js | 4003 | Process payments for orders (calls order-service) |
| `frontend` | Static HTML/JS | 80 | UI that communicates with all services via API Gateway (Ingress) |

All services connect to a shared **Azure MySQL Flexible Server** and use **Azure Key Vault** for secrets.

---

## Requirements

### 1. Infrastructure — Terraform
Provision the following Azure resources using Terraform:
- Resource Group
- Virtual Network + Subnets
- Azure Kubernetes Service (AKS) cluster
- Azure Container Registry (ACR)
- Azure MySQL Flexible Server (shared DB)
- Azure Key Vault
- Managed Identity (for AKS to access Key Vault)
- Azure Monitor + Log Analytics Workspace

### 2. Containerization — Docker
- Write a production-ready multi-stage `Dockerfile` for each service
- Push all images to ACR with proper tagging (`<acr>.azurecr.io/<service>:<buildId>`)
- Images must run as non-root users

### 3. Kubernetes Deployment — AKS
Deploy all 4 services on AKS with:
- `Deployment` for each service with readiness and liveness probes
- `Service` (ClusterIP) for each
- `HorizontalPodAutoscaler` for each (CPU + memory based)
- Single `Ingress` with path-based routing:
  - `/auth/*` → auth-service
  - `/orders/*` → order-service
  - `/payments/*` → payment-service
  - `/` → frontend
- `Namespace`: `microservices`
- Secrets pulled from Azure Key Vault via CSI driver (no hardcoded secrets)

### 4. CI/CD — Azure DevOps Pipelines
Create a multi-stage pipeline with **separate jobs per service**:
- **Stage 1 — Validate**: Lint + unit test all services in parallel
- **Stage 2 — Build & Push**: Build Docker images and push to ACR (only on changes to that service)
- **Stage 3 — Deploy**: Deploy updated services to AKS using `kubectl`
- **Stage 4 — Smoke Test**: Hit each service health endpoint and verify 200 response

### 5. Monitoring
- Configure Azure Monitor alerts for:
  - Pod CPU > 80% for 5 minutes
  - Pod restart count > 3
  - HTTP 5xx error rate > 1%
- Enable container insights on AKS

### 6. Security
- All secrets (DB credentials, JWT secret) stored in Azure Key Vault
- AKS uses Managed Identity to access Key Vault — NO hardcoded credentials anywhere
- Enable network policies between services (order-service can only talk to payment-service, not directly to auth-service DB)

---

## Debugging Challenge

After deploying all services and scaling `order-service` to **5 replicas**, the service starts returning `500 Internal Server Error` intermittently under load.

**Your task:**
1. Identify the root cause
2. Fix it in the code
3. Explain the debugging steps you took in `DEBUG.md`

> Hint: The issue is related to how the service manages connections under concurrent load from multiple pods.

---

## Deliverables

Your submitted GitHub repo must contain:

```
devops-machine-test-advanced/
├── services/
│   ├── auth-service/
│   │   ├── src/server.js       # provided — DO NOT modify unless fixing the bug
│   │   ├── package.json        # provided
│   │   └── Dockerfile          # you write this
│   ├── order-service/
│   │   ├── src/server.js       # provided — contains intentional bug
│   │   ├── package.json        # provided
│   │   └── Dockerfile          # you write this
│   ├── payment-service/
│   │   ├── src/server.js       # provided
│   │   ├── package.json        # provided
│   │   └── Dockerfile          # you write this
│   └── frontend/
│       ├── src/index.html      # provided
│       └── Dockerfile          # you write this
├── k8s/
│   ├── namespace.yaml          # you write this
│   ├── deployment.yaml         # you write this
│   ├── service.yaml            # you write this
│   ├── ingress.yaml            # you write this
│   ├── hpa.yaml                # you write this
│   └── secrets.yaml            # you write this (Key Vault CSI)
├── terraform/
│   ├── main.tf                 # you write this
│   ├── variables.tf            # you write this
│   ├── outputs.tf              # you write this
│   └── providers.tf            # provided
├── azure-pipelines.yml         # you write this
├── DEBUG.md                    # you write this
└── README.md
```

## Evaluation Criteria

| Area | Weight |
|---|---|
| Terraform — correctness and modularity | 20% |
| Dockerfiles — multi-stage, non-root, optimized | 15% |
| Kubernetes — probes, HPA, Ingress, secrets | 25% |
| CI/CD Pipeline — stages, parallelism, ACR push | 20% |
| Debugging — root cause identified and fixed | 10% |
| Security — Key Vault integration, no hardcoded secrets | 10% |

---

## Time Limit: 6–8 hours
