// Determinar API_URL dinámicamente según el origen actual
const API_URL = window.location.origin;

// ── Constantes de negocio (centralizadas) ──────────────────────────────────
// Modificar aquí para ajustar parámetros sin tocar la lógica
const APP_CONFIG = {
    // Factor de impacto ambiental: kg CO₂ evitado por unidad donada o reciclada
    CO2_KG_POR_UNIDAD: 0.5,
    // Factor de impacto social: raciones alimentarias estimadas por unidad donada
    RACIONES_POR_UNIDAD: 2.5,
    // Destinos por defecto cuando el usuario no completa el campo
    DESTINO_DEFAULT_DONAR: "Banco de Alimentos / ONG",
    DESTINO_DEFAULT_RECICLAR: "Centro de Reciclaje Autorizado",
    DESTINO_DEFAULT_ELIMINAR: "Gestión de Merma / Residuos",
    // Millisegundos de espera antes de re-analizar tras un tratamiento
    REANALISIS_DEBOUNCE_MS: 1500,
};
// ───────────────────────────────────────────────────────────────────────────

window.handleCredentialResponse = async (response) => {
    try {
        const res = await fetch(`${API_URL}/auth/google`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: response.credential })
        });

        if (res.ok) {
            const data = await res.json();
            localStorage.setItem("token", data.token_acceso);
            localStorage.setItem("nombre_usuario", data.nombre_usuario || "Usuario Google");
            localStorage.setItem("empresa", data.empresa || "");
            showToast("Acceso con Google exitoso. Redirigiendo...", "success");
            setTimeout(() => window.location.href = "dashboard.html", 1000);
        } else {
            showToast("Error al autenticar con Google.", "error");
        }
    } catch (e) {
        showToast("Error de conexión con el servidor.", "error");
    }
};

// Gestión de Notificaciones (Toasts)
function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("loginForm") || document.getElementById("registerPageForm")) {
        inicializarAutenticacion();
    } else if (document.getElementById("control-maestro")) {
        inicializarTablero();
        inicializarPestanas();
        inicializarSensibilidad();

        // Listener para Limpiar DB
        document.getElementById("resetDbBtn")?.addEventListener("click", resetearBaseDatos);
    }
});

function inicializarAutenticacion() {
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const u = document.getElementById("nombre-usuario").value;
            const p = document.getElementById("contrasena").value;
            realizarAcceso(u, p);
        });
    }

    document.getElementById("registerPageForm")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const data = {
            nombre_usuario: document.getElementById("reg-nombre-usuario").value,
            email: document.getElementById("reg-email").value,
            contrasena: document.getElementById("reg-contrasena").value,
            empresa: document.getElementById("reg-company").value,
            telefono: document.getElementById("reg-phone").value
        };
        realizarRegistro(data);
    });
}

async function realizarAcceso(nombre_usuario, contrasena) {
    const btn = document.querySelector(".btn-primary-gradient") || document.querySelector("#loginForm button");
    const originalText = btn.innerHTML;

    try {
        btn.disabled = true;
        btn.innerHTML = '<span class="loader"></span> Iniciando sesión...';

        const formData = new URLSearchParams();
        formData.append("username", nombre_usuario);
        formData.append("password", contrasena);

        const res = await fetch(`${API_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formData
        });

        if (res.ok) {
            const data = await res.json();
            localStorage.setItem("token", data.token_acceso);
            localStorage.setItem("nombre_usuario", data.nombre_usuario || nombre_usuario);
            localStorage.setItem("empresa", data.empresa || "");
            showToast("Acceso concedido. Redirigiendo...", "success");
            setTimeout(() => window.location.href = "dashboard.html", 1000);
        } else {
            showToast("Credenciales incorrectas.", "error");
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    } catch (e) {
        showToast("Error de conexión con el servidor.", "error");
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function realizarRegistro(data) {
    const btn = document.querySelector("#registerPageForm button");
    const originalText = btn.innerHTML;

    try {
        btn.disabled = true;
        btn.innerHTML = '<span class="loader"></span> Creando cuenta...';

        const res = await fetch(`${API_URL}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });

        if (res.ok) {
            showToast("Registro exitoso. Ya puedes iniciar sesión.", "success");
            setTimeout(() => window.location.href = "index.html", 2000);
        } else {
            const err = await res.json();
            showToast("Error: " + (err.detalle || err.detail || "No se pudo registrar"), "error");
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    } catch (e) {
        showToast("Error en el servidor al intentar registrar.", "error");
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// ---- DASHBOARD LOGIC ----


// Helper global para actualizar métricas e indicadores localmente (HU-COHERENCIA)
window.actualizarInterfazLocal = function () {

    // Normalizar nombres de estado (VENCIDO vs CRÍTICO vs CRITICO)
    const normalize = (s) => (s || "NORMAL").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const estadosRecalc = {
        "VENCIDO": { productos: 0, unidades: 0, valor: 0.0, stock0: 0 },
        "CRITICO": { productos: 0, unidades: 0, valor: 0.0, stock0: 0 },
        "URGENTE": { productos: 0, unidades: 0, valor: 0.0, stock0: 0 },
        "PREVENTIVO": { productos: 0, unidades: 0, valor: 0.0, stock0: 0 },
        "NORMAL": { productos: 0, unidades: 0, valor: 0.0, stock0: 0 }
    };

    // Recalcular a partir de DATOS_CRUDOS (el estado de la verdad en el cliente)
    (DATOS_CRUDOS || []).forEach(item => {
        const stockNum = parseFloat(item.cantidad_stock || 0);
        // HU-COHERENCIA: Usar stock físico para las unidades en los cards de riesgo
        // para que coincidan con los encabezados de la tabla.
        const estNorm = normalize(item.estado_alerta);

        // HU-COHERENCIA: Si no hay stock, el item se considera REORDEN para la UI principal
        // de alertas, igual que en la función renderizarTabla.
        let targetEstado = estNorm;
        if (stockNum <= 0 || estNorm === "REORDEN" || estNorm === "REPUESTO") {
            targetEstado = "CRITICO";
        }

        if (estadosRecalc.hasOwnProperty(targetEstado)) {
            estadosRecalc[targetEstado].productos += 1;
            estadosRecalc[targetEstado].unidades += stockNum;
            estadosRecalc[targetEstado].valor += parseFloat(item.valor_stock || 0);
        } else {
            // Si el estado no es reconocido, va a NORMAL
            estadosRecalc["NORMAL"].productos += 1;
            estadosRecalc["NORMAL"].unidades += stockNum;
            estadosRecalc["NORMAL"].valor += parseFloat(item.valor_stock || 0);
        }
    });

    // HU-CONTINUIDAD: Cálculo global de quiebres para la nueva sección informativa
    let totalQuiebresManaged = 0;
    let totalQuiebresUnmanaged = 0;
    let totalInvReorden = 0.0;

    (DATOS_CRUDOS || []).forEach(item => {
        const stockNum = parseFloat(item.cantidad_stock || 0);
        const stockNeto = parseFloat(item.stock_neto || stockNum);

        if (stockNum <= 0) {
            if (stockNeto > 0) totalQuiebresManaged++;
            else {
                totalQuiebresUnmanaged++;
                totalInvReorden += (Math.abs(stockNeto) * parseFloat(item.costo_unitario || 0));
            }
        }
    });

    window.INFO_CONTINUIDAD = {
        total: totalQuiebresUnmanaged + totalQuiebresManaged,
        unmanaged: totalQuiebresUnmanaged,
        investment: totalInvReorden
    };

    // Mapear de vuelta a los nombres con acentos para METRICAS
    if (!METRICAS) METRICAS = {};
    METRICAS.estados = {
        "VENCIDO": estadosRecalc["VENCIDO"],
        "CRÍTICO": estadosRecalc["CRITICO"],
        "URGENTE": estadosRecalc["URGENTE"],
        "PREVENTIVO": estadosRecalc["PREVENTIVO"],
        "NORMAL": estadosRecalc["NORMAL"]
    };

    try {
        if (typeof renderizarTabla === "function") renderizarTabla(DATOS_CRUDOS);
        if (typeof renderizarIndicadores === "function") renderizarIndicadores();
        if (typeof renderizarGraficos === "function") renderizarGraficos();
        if (typeof window.renderRecomendacionesIA === "function") window.renderRecomendacionesIA(window.ULTIMAS_RECOMENDACIONES || []);
    } catch (e) {
        console.error("❌ Error en re-renderizado local:", e);
    }
};

async function inicializarPestanas() {
    const tabs = document.querySelectorAll('.sidebar-item[data-tab]');
    const sections = document.querySelectorAll('.tab-content');
    const breadcrumbCurrent = document.getElementById('current-view-name');

    const globalControls = document.getElementById("globalControls");

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.style.display === 'none') return;

            tabs.forEach(t => t.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));

            tab.classList.add('active');
            document.body.classList.remove('sidebar-open');
            const targetId = tab.getAttribute('data-tab');
            const targetSection = document.getElementById(targetId);

            // Update breadcrumb
            if (breadcrumbCurrent) {
                breadcrumbCurrent.textContent = tab.textContent.trim();
            }

            if (targetSection) {
                targetSection.classList.add('active');
                const contentArea = document.querySelector('.content-area');
                if (contentArea) {
                    contentArea.scrollTop = 0;
                    // Reset sticky headers behavior
                    contentArea.setAttribute('scroll', '0');
                }

            }

            if (targetId === 'logistica') {
                // Re-renderizar siempre al entrar a la pestaña:
                // El mapa Leaflet requiere que el contenedor sea visible para calcular su tamaño.
                // Si los datos se cargaron mientras el usuario estaba en otra pestaña,
                // renderMap nunca pudo inicializar el mapa. Por eso lo hacemos aquí también.
                if (DATOS_CRUDOS && DATOS_CRUDOS.length > 0) {
                    setTimeout(() => {
                        renderMap(DATOS_CRUDOS);
                        // invalidateSize es necesario para Leaflet cuando el contenedor
                        // no era visible en el momento de la primera inicialización
                        if (window.mapInstance) window.mapInstance.invalidateSize();
                    }, 150); // 150ms para que el DOM actualice la visibilidad del tab
                }
            }


            if (targetId === 'control-maestro') {
                requestAnimationFrame(() => {
                    Object.values(_charts).forEach(c => { if (c) c.resize(); });
                });
            }

            if (globalControls) {
                globalControls.style.display = (targetId === 'home' || targetId === 'inspector' || targetId === 'sensibilidad' || targetId === 'impacto-social') ? 'none' : 'flex';
            }

            // --- HU: Mi Orden solo en Previsión de Demanda ---
            const orderStatus = document.getElementById('orderStatus');
            if (orderStatus) {
                orderStatus.style.display = (targetId === 'sensibilidad') ? 'flex' : 'none';
            }

            if (targetId === 'home') {
                // Al volver a Home: NO cerramos el análisis activo para que persista
                // Solo refrescamos la lista para mostrar el estado actualizado
                if (window.renderizarListaAnalisis) window.renderizarListaAnalisis();
            }

            if (targetId === 'inspector') {
                if (window.cargarListaArchivos) window.cargarListaArchivos();
            }

            if (targetId === 'impacto-social') {
                cargarImpactoSocial();
            }

            if (targetId === 'sensibilidad') {
                cargarDashboardForecastingGeneral();
            }
        });
    });

    document.getElementById("logoutBtn")?.addEventListener("click", () => {
        localStorage.removeItem("token");
        window.location.href = "index.html";
    });

    const storedUser = localStorage.getItem("nombre_usuario");
    const storedCompany = localStorage.getItem("empresa");

    if (storedUser) {
        const displayName = storedUser.charAt(0).toUpperCase() + storedUser.slice(1);
        const userNameEl = document.getElementById("userNameDisplay");
        if (userNameEl) userNameEl.textContent = displayName;

        const initials = displayName.substring(0, 2).toUpperCase();
        const avatarEl = document.getElementById("userAvatar");
        if (avatarEl) avatarEl.textContent = initials;
    }

    if (storedCompany !== null) {
        const companyEl = document.getElementById("userRoleDisplay");
        if (companyEl) companyEl.textContent = storedCompany || "Pyme Registrada";
    }

    // Auto-activar la lógica de la pestaña marcada como activa al cargar (HU-GEN-01)
    setTimeout(() => {
        const lastTab = localStorage.getItem("ultima_pestaña");
        let targetTab = null;
        if (lastTab) targetTab = document.querySelector(`.sidebar-item[data-tab="${lastTab}"]`);
        if (!targetTab) targetTab = document.querySelector('.sidebar-item.active');
        if (targetTab) targetTab.click();

        // Limpiar para que la próxima carga normal (F5) use el default si no hay acción pendiente
        localStorage.removeItem("ultima_pestaña");
    }, 100);

    // Restaurar visibilidad del grupo de análisis si había uno activo al recargar
    if (_analisisActivo) {
        const sidebarGroup = document.getElementById('sidebar-analisis-group');
        const sidebarNombre = document.getElementById('sidebar-analisis-nombre');
        if (sidebarGroup) sidebarGroup.style.display = 'block';
        if (sidebarNombre) {
            const displayName = _analisisNombres[_analisisActivo] || _analisisActivo.replace(/\.csv$/i, '');
            sidebarNombre.textContent = displayName;
        }
    }
}

let DATOS_CRUDOS = [];
let METRICAS = {};
let LIMITES_FECHA = {};
let SLIDER_CONFIGURADO = false;
let DONACIONES_RECIENTES = new Set();
let TACTICAS_APLICADAS = new Set();
let GRUPOS_ABIERTOS = new Set(["grupo-VENCIDO", "grupo-CR\u00cdTICO"]);

// HU-PERSISTENCIA: Helpers para mantener el estado visual tras recargar
window._guardarPersistenciaTacticas = function () {
    try {
        const id = window._analisisActivo || 'global';
        localStorage.setItem(`tacticas_${id}`, JSON.stringify(Array.from(TACTICAS_APLICADAS)));
        localStorage.setItem(`donaciones_${id}`, JSON.stringify(Array.from(DONACIONES_RECIENTES)));
    } catch (e) { console.error("Error guardando persistencia:", e); }
};

window._cargarPersistenciaTacticas = function () {
    try {
        const id = window._analisisActivo || 'global';
        const st = localStorage.getItem(`tacticas_${id}`);
        const sd = localStorage.getItem(`donaciones_${id}`);
        if (st) TACTICAS_APLICADAS = new Set(JSON.parse(st));
        else TACTICAS_APLICADAS = new Set();
        if (sd) DONACIONES_RECIENTES = new Set(JSON.parse(sd));
        else DONACIONES_RECIENTES = new Set();

        // PERSISTENCIA DE ORDEN (HU-PLAN)
        const so = localStorage.getItem(`items_orden_${id}`);
        if (so) {
            const parsed = JSON.parse(so);
            window.ITEMS_ORDEN = new Map(Object.entries(parsed));
        } else {
            window.ITEMS_ORDEN = new Map();
        }
    } catch (e) {
        console.error("Error cargando persistencia:", e);
        TACTICAS_APLICADAS = new Set();
        DONACIONES_RECIENTES = new Set();
        window.ITEMS_ORDEN = new Map();
    }
};

window._guardarPersistenciaOrden = function () {
    try {
        const id = window._analisisActivo || 'global';
        const obj = Object.fromEntries(window.ITEMS_ORDEN);
        localStorage.setItem(`items_orden_${id}`, JSON.stringify(obj));
    } catch (e) { console.error("Error guardando orden:", e); }
};
window.IA_PLAN_ACCION = {};           // Mapeo Producto -> Recomendación de IA
window._filtroCategoriaCrisis = {};    // Categoría filtrada por cada estado (VENCIDO, CRÍTICO, etc)
window.IA_PLAN_ACCION_GLOBAL = {};    // Estrategias por categoria de riesgo
window.IA_PLAN_ACCION_GLOBAL_APLICADO = false; // Toggle de visibilidad en tabla
window.SENSIBILIDAD_ACTUAL = null;    // Impacto financiero deterministic (HU-08)
window._mostrarTablaVencidosCompleta = false; // false = Vista Crisis; true = lista cruda completa
window.SELECCION_ESTADOS_RIESGO = new Set();  // Selección multi-estado (Power BI Style HU-05)
window.ITEMS_ORDEN = new Map();       // Global state for orders
window.sensitivityChart = null;       // Chart instance

// Set up scroll observer once the page loads
// Scroll listener removed for stability (Fixed "bounce" issue HU)

async function inicializarTablero(horizon = 0) {
    const token = localStorage.getItem("token");
    if (!token) { window.location.href = "index.html"; return; }

    try {
        const h = horizon !== undefined ? horizon : 0; // Default a vista Global
        const params = new URLSearchParams({ horizonte: h });
        // Pasar el análisis activo como filtro de fuente → aislamiento completo por dataset
        if (_analisisActivo) params.set("fuente", _analisisActivo);

        // Auto-reactivar el análisis activo en el backend (por si se reinició el servidor o el parquet fue borrado)
        if (_analisisActivo) {
            try {
                await fetch(`${API_URL}/api/analyses/${encodeURIComponent(_analisisActivo)}/activate`, {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${token}` }
                });
            } catch (e) { /* silencioso, el tablero mostrará lo que haya */ }
        }

        const res = await fetch(`${API_URL}/api/analysis?${params.toString()}`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.status === 401) {
            localStorage.removeItem("token");
            window.location.href = "index.html"; return;
        }

        const data = await res.json();
        DATOS_CRUDOS = data.inventario || [];
        console.debug("📦 Datos cargados:", DATOS_CRUDOS.length);
        METRICAS = data.metricas || {};
        const INDICADORES = data.indicadores || {};
        window.TIPO_ANALISIS = data.tipo_analisis || "EXPIRACION";
        window.HOY = new Date().toISOString().split('T')[0]; // Siempre la fecha real del sistema
        window.HOY_DATASET = data.hoy_dataset || data.hoy || window.HOY; // Fecha de referencia del dataset (para cálculos internos)

        // Visualización Adaptativa: Ocultar pestaña logística si no hay datos geo o sucursales
        const mapTab = document.querySelector('.sidebar-item[data-tab="logistica"]');
        const tieneGeo = INDICADORES.has_geo && DATOS_CRUDOS.some(item => item.latitud || item.lat);
        const tieneSucursales = INDICADORES.has_branches || DATOS_CRUDOS.some(item => item.nombre_ubicacion);
        if (mapTab) {
            mapTab.style.display = (tieneGeo || tieneSucursales) ? 'flex' : 'none';
        }

        if (!SLIDER_CONFIGURADO) {
            LIMITES_FECHA = data.limites || {};
            configurarControlHorizonte();
            SLIDER_CONFIGURADO = true;
        }

        window.SELECCION_ESTADOS_RIESGO = new Set();
        renderizarIndicadores();

        // Sincronizar Donaciones Recientes para persistencia visual (HU-07)
        try {
            const resDon = await fetch(`${API_URL}/api/donations`, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (resDon.ok) {
                const list = await resDon.json();
                DONACIONES_RECIENTES.clear();
                list.forEach(d => DONACIONES_RECIENTES.add(d.id_producto));
            }
        } catch (e) { console.error("Error sincronizando donaciones:", e); }

        if (DATOS_CRUDOS.length === 0) {
            const hasDatesInDB = LIMITES_FECHA && LIMITES_FECHA.min;
            vaciarTablero(hasDatesInDB ? "no_results" : "no_files");
        } else {
            procesarDatosTablero();
            // Cargar recomendaciones de IA con el horizonte y filtros actuales
            const mes = window._FILTRO_MES || null;
            const anio = window._FILTRO_ANIO || null;
            cargarRecomendacionesIA(mes, anio, h);
            // Cargar forecasting general con filtros temporales
            cargarDashboardForecastingGeneral(mes, anio);

            // Refrescar lista de orden si existe persistencia
            if (window.actualizarListaOrden) window.actualizarListaOrden();
            if (window.actualizarContadorOrdenHeader) window.actualizarContadorOrdenHeader();
        }
    } catch (err) {
        console.error("Error cargando el tablero:", err);
    }
}

function configurarControlHorizonte() {
    const selectHorizonte = document.getElementById("horizonteRiesgo");
    const labelHorizonte = document.getElementById("horizonteLabel");
    const resetBtn = document.getElementById("resetFilters");

    if (!selectHorizonte) return;

    const HORIZON_LABELS = {
        0: "Todo el Inventario",
        7: "7 días — Crítico",
        30: "30 días — Operativo",
        90: "90 días — Trimestre",
        180: "6 meses — Estratégico",
        365: "1 año — Anual"
    };

    const getHorizonLabel = (days) => {
        if (days == 0) return "Global — Sin límite";
        const label = HORIZON_LABELS[days] || `${days} días`;
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + parseInt(days));
        const dateStr = targetDate.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
        return `${label} (Hasta ${dateStr})`;
    };

    // Sync: dropdown cambia → actualiza todo
    selectHorizonte.addEventListener("change", () => {
        const val = parseInt(selectHorizonte.value);
        if (labelHorizonte) labelHorizonte.textContent = getHorizonLabel(val);
        actualizarBadgeHorizonte(val);
        inicializarTablero(val);
    });

    // Reset → vista global
    resetBtn?.addEventListener("click", () => {
        selectHorizonte.value = 0;
        if (labelHorizonte) labelHorizonte.textContent = "Global — Sin límite";
        actualizarBadgeHorizonte(0);
        inicializarTablero(0);
    });

    // Inicializar con valor expreso del select (HU-FIX: evitamos que 0 lo convierta en 30 vía ||)
    const valRaw = selectHorizonte.value;
    const initVal = (valRaw === "" || valRaw === undefined) ? 30 : parseInt(valRaw);
    if (labelHorizonte) labelHorizonte.textContent = getHorizonLabel(initVal);

    actualizarBadgeHorizonte(initVal);
}

function actualizarBadgeHorizonte(diasHorizonte) {
    // Mostrar en el subtítulo de la clasificación qué horizonte está activo
    const badgeEl = document.getElementById("horizonte-badge-activo");
    if (!badgeEl) return;
    if (diasHorizonte === 0) {
        badgeEl.innerHTML = "";
    } else {
        const color = diasHorizonte <= 7 ? "#ef4444" : diasHorizonte <= 30 ? "#f97316" : diasHorizonte <= 90 ? "#eab308" : "#3b82f6";
        badgeEl.innerHTML = `<span style="background:${color}15; color:${color}; padding:3px 10px; border-radius:100px; font-size:0.72rem; font-weight:700; border:1px solid ${color}40;">⏱ Horizonte: próximos ${diasHorizonte} días</span>`;
    }
}

function procesarDatosTablero() {
    const searchInput = document.getElementById("busqueda-inventario");
    searchInput?.addEventListener("input", actualizarVistasTablero);

    window.actualizarInterfazLocal();
}

function actualizarVistasTablero() {
    renderizarIndicadores();

    if (DATOS_CRUDOS.length === 0) {
        // Si no hay datos crudos desde el servidor, es que no hay archivos
        vaciarTablero("no_files");
        return;
    }

    const searchVal = document.getElementById("busqueda-inventario")?.value.toLowerCase() || "";

    const filteredData = DATOS_CRUDOS.filter(item => {
        const nombre = (item["nombre_producto"] || "").toLowerCase();
        return nombre.includes(searchVal);
    });

    if (filteredData.length === 0) {
        // Si hay búsqueda activa pero no hay resultados locales
        vaciarTablero("no_results");
        return;
    }

    renderizarGraficos();
    renderizarTabla(filteredData);
    renderMap(filteredData);
    if (typeof window.renderIAAssistant === "function") window.renderIAAssistant(METRICAS.insights);
}

// Instancias de gráficos para poder destruirlos antes de recrear
const _charts = {};

// Dibuja un rectángulo redondeado sin usar ctx.roundRect() (no soportado en todos los navegadores)
function _fillRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
}

// Factory: crea un plugin con ID único para cada instancia de gráfico
function _makeSlicePlugin(uid) {
    return {
        id: `sliceLabels_${uid}`,
        afterDraw(chart) {
            try {
                const { ctx, data } = chart;
                const dataset = data.datasets[0];
                const total = dataset.data.reduce((a, b) => a + b, 0);
                if (total === 0) return;
                const meta = chart.getDatasetMeta(0);
                ctx.save();
                let lastYRight = -999;
                let lastYLeft = -999;

                meta.data.forEach((arc, i) => {
                    const val = dataset.data[i];
                    if (!val) return;
                    const pct = (val / total) * 100;
                    const mid = (arc.startAngle + arc.endAngle) / 2;
                    const cosM = Math.cos(mid);
                    const sinM = Math.sin(mid);
                    const text = pct < 1 ? "<1%" : `${pct.toFixed(0)}%`;
                    const color = dataset.backgroundColor[i];

                    if (pct >= 8) {
                        // Label DENTRO del segmento
                        const r = (arc.innerRadius + arc.outerRadius) / 2;
                        const x = arc.x + cosM * r;
                        const y = arc.y + sinM * r;
                        ctx.font = "bold 12px Inter, sans-serif";
                        const tw = ctx.measureText(text).width;
                        const pad = 5, bh = 20;
                        ctx.fillStyle = "rgba(0,0,0,0.55)";
                        _fillRoundRect(ctx, x - tw / 2 - pad, y - bh / 2, tw + pad * 2, bh, 4);
                        ctx.fillStyle = "#fff";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText(text, x, y);
                    } else if (pct > 0) {
                        // Línea guía hacia afuera
                        const outerR = arc.outerRadius;
                        const lx1 = arc.x + cosM * outerR;
                        const ly1 = arc.y + sinM * outerR;
                        let lx2 = arc.x + cosM * (outerR + 16);
                        let ly2 = arc.y + sinM * (outerR + 16);
                        const goRight = cosM >= 0;

                        // Anti-colisión vertical simple adaptado a orden circular (sentido horario)
                        if (goRight) {
                            if (lastYRight !== -999 && ly2 < lastYRight + 14) {
                                ly2 = lastYRight + 14;
                            }
                            lastYRight = ly2;
                        } else {
                            if (lastYLeft !== -999 && ly2 > lastYLeft - 14) {
                                ly2 = lastYLeft - 14;
                            }
                            lastYLeft = ly2;
                        }

                        const hLen = 14;
                        const hx = lx2 + (goRight ? hLen : -hLen);

                        ctx.strokeStyle = color;
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        ctx.moveTo(lx1, ly1);
                        ctx.lineTo(lx2, ly2);
                        ctx.lineTo(hx, ly2);
                        ctx.stroke();

                        ctx.fillStyle = color;
                        ctx.beginPath();
                        ctx.arc(lx1, ly1, 2, 0, Math.PI * 2);
                        ctx.fill();

                        ctx.font = "bold 10px Inter, sans-serif";
                        ctx.fillStyle = "#111827";
                        ctx.textAlign = goRight ? "left" : "right";
                        ctx.textBaseline = "middle";
                        ctx.fillText(text, hx + (goRight ? 3 : -3), ly2);
                    }
                });
                ctx.restore();
            } catch (e) {
                // silently ignore canvas errors
            }
        }
    };
}

function renderizarGraficos() {
    const estados = METRICAS.estados || {};
    const ORDEN = ["VENCIDO", "CRÍTICO", "URGENTE", "PREVENTIVO", "NORMAL"];
    const COLORES = {
        "VENCIDO": "#9333ea",
        "CRÍTICO": "#ef4444",
        "URGENTE": "#f97316",
        "PREVENTIVO": "#eab308",
        "NORMAL": "#22c55e"
    };

    const labels = [];
    const colors = [];
    const productos = [];
    const valores = [];
    const unidades = [];

    ORDEN.forEach(e => {
        if (estados[e] && (estados[e].productos > 0 || e === "NORMAL")) {
            labels.push(e);
            colors.push(COLORES[e]);
            productos.push(estados[e].productos);
            valores.push(estados[e].valor);
            unidades.push(estados[e].unidades);
        }
    });

    if (productos.reduce((a, b) => a + b, 0) === 0) {
        ["chartProductos", "chartValor", "chartUnidades"].forEach(id => {
            if (_charts[id]) {
                _charts[id].destroy();
                _charts[id] = null;
            }
        });
        return;
    }

    const buildConfig = (data, uid) => {
        const total = data.reduce((a, b) => a + b, 0);
        return {
            type: "doughnut",
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: "#fff",
                    hoverOffset: 10
                }]
            },
            options: {
                cutout: "56%",
                animation: { animateRotate: true, duration: 800 },
                layout: { padding: 44 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                                return ` ${ctx.label}: ${ctx.formattedValue} (${pct}%)`;
                            }
                        }
                    }
                }
            },
            plugins: [_makeSlicePlugin(uid)]
        };
    };

    [
        { id: "chartProductos", data: productos },
        { id: "chartValor", data: valores },
        { id: "chartUnidades", data: unidades }
    ].forEach(({ id, data }) => {
        const canvas = document.getElementById(id);
        if (!canvas) return;
        if (_charts[id]) { _charts[id].destroy(); }
        _charts[id] = new Chart(canvas, buildConfig(data, id));
    });

    // Resize charts after paint to ensure canvas has real dimensions
    requestAnimationFrame(() => {
        Object.values(_charts).forEach(c => { if (c) c.resize(); });
    });

    // ── Leyenda compartida HTML ──
    const legendEl = document.getElementById("sharedChartLegend");
    if (legendEl) {
        legendEl.innerHTML = labels.map((lbl, i) => `
            <span style="display:inline-flex; align-items:center; gap:5px; font-size:0.82rem; color:#374151; font-weight:500;">
                <span style="width:10px; height:10px; border-radius:50%; background:${colors[i]}; flex-shrink:0;"></span>
                ${lbl}
            </span>`).join("");
    }
}


window.cargarRecomendacionesIA = async function (mes = null, anio = null, horizonte = 0) {
    const cardEl = document.querySelector(".ia-card");
    if (!cardEl) return;

    const etiquetaHorizonte = horizonte > 0 ? `${horizonte} días` : "Global";
    cardEl.innerHTML = `
        <div class="ia-header" style="margin-bottom: 1.5rem;">
            <div style="display:flex; align-items:center; gap:0.75rem;">
                <span class="loader" style="width:20px; height:20px; border-color: #a855f7; border-bottom-color: transparent;"></span>
                <span style="font-weight: 700; font-size: 1.1rem; color: #fff;">Sugerencias Prescriptivas</span>
                <span style="font-size: 0.65rem; background: rgba(168,85,247,0.3); padding: 2px 8px; border-radius: 100px; color: #d8b4fe;">MOTOR DE ANÁLISIS ESTRATÉGICO</span>
            </div>
        </div>
        <p style="font-size: 0.9rem; opacity: 0.8;">Horizonte: ${etiquetaHorizonte} — Calculando estrategia...</p>
    `;

    try {
        const token = localStorage.getItem("token");
        let url = `${API_URL}/api/ai-recommendations`;
        const params = [];
        if (horizonte && horizonte > 0) params.push(`horizonte=${horizonte}`);
        if (window._analisisActivo) params.push(`fuente=${encodeURIComponent(window._analisisActivo)}`);
        if (params.length > 0) url += `?${params.join("&")}`;

        const res = await fetch(url, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Error en motor IA");
        const data = await res.json();
        window.SENSIBILIDAD_ACTUAL = data.sensibilidad_global;
        // Solo resetear estado de aplicación al cargar NUEVAS recomendaciones de red
        window.IA_PLAN_ACCION_GLOBAL_APLICADO = false;
        renderRecomendacionesIA(data.recomendaciones);
    } catch (err) {
        console.error("Error cargando recomendaciones:", err);
        // Fallback a los insights básicos si falla el motor avanzado
        if (typeof renderIAAssistant === 'function') {
            renderIAAssistant(METRICAS.insights);
        }
    }
}

// Fallback o versión simplificada del asistente IA
window.renderIAAssistant = function (insights) {
    const cardEl = document.querySelector(".ia-card");
    if (!cardEl) return;

    // Si ya hay recomendaciones detalladas (renderRecomendacionesIA fue exitoso), no sobrescribir con el fallback
    if (window.ULTIMAS_RECOMENDACIONES && window.ULTIMAS_RECOMENDACIONES.length > 0) {
        return;
    }

    if (!insights || insights.length === 0) {
        cardEl.innerHTML = `
            <div class="ia-header" style="border-bottom: 2px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 20px;">
                <span style="font-weight: 800; font-size: 1.1rem; color: #1e293b;">Analista Operativo</span>
            </div>
            <div style="display:flex; align-items:center; gap:12px; opacity:0.6;">
                <div style="width:14px; height:14px; border:2px solid #6366f1; border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite;"></div>
                <span style="font-size: 0.9rem; color: #475569; font-weight: 600;">Analizando tendencias globales...</span>
            </div>
        `;
        return;
    }

    let html = `
        <div class="ia-header" style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f1f5f9; padding-bottom: 1rem;">
            <div style="display:flex; align-items:center; gap:0.75rem;">
                <div style="background: #6366f1; padding: 6px; border-radius: 8px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                </div>
                <span style="font-weight: 800; font-size: 1.2rem; color: #1e293b; letter-spacing: -0.5px;">Diagnóstico de Activos</span>
            </div>
            <button onclick="window.cargarRecomendacionesIA()" style="background: #f1f5f9; border: 1px solid #e2e8f0; color: #6366f1; padding: 6px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; transition: all 0.2s;">
                RE-ANALIZAR
            </button>
        </div>
    `;

    insights.forEach(ins => {
        // Handle structured object or string
        let titulo = "Sugerencia";
        let desc = "";
        let color = "#a855f7";

        if (typeof ins === 'string') {
            desc = ins;
        } else if (ins && typeof ins === 'object') {
            titulo = ins.titulo || (ins.tipo === 'ALERTA' ? 'Alerta' : 'Estrategia');
            desc = ins.desc || ins.descripcion || JSON.stringify(ins);
            if (ins.tipo === 'ALERTA') color = "#ef4444";
        }

        html += `
            <div class="ia-insight" style="background: #f8fafc; padding: 1.25rem; border-radius: 12px; margin-bottom: 1rem; border: 1px solid #e2e8f0; border-left: 4px solid ${color}; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                <h5 style="margin:0 0 6px 0; font-size: 0.75rem; color: ${color}; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px;">${titulo}</h5>
                <p style="margin:0; font-size: 0.95rem; line-height: 1.5; color: #334155; font-weight: 500;">${desc}</p>
            </div>
        `;
    });

    cardEl.innerHTML = html;
}

window.renderRecomendacionesIA = function (recomendaciones) {
    const cardEl = document.querySelector(".ia-card");
    if (!cardEl) return;

    let html = `
        <div class="ia-header" style="margin-bottom: 2.5rem; position:relative; z-index:2;">
            <div style="display:flex; align-items:center; gap:0.75rem;">
                <div style="background: linear-gradient(135deg, #a855f7, #6366f1); padding: 10px; border-radius: 12px; box-shadow: 0 8px 16px rgba(99, 102, 241, 0.2);">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                        <line x1="12" y1="22.08" x2="12" y2="12"></line>
                    </svg>
                </div>
                <div>
                    <span style="font-weight: 900; font-size: 1.4rem; color: #1e293b; letter-spacing: -0.7px; display:block;">Reporte de Optimización <span style="color:#6366f1;">Virtual</span></span>
                    <span style="font-size:0.7rem; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.15em; margin-top:2px; display:block;">Protocolos de Seguridad y Combos Estratégicos</span>
                </div>
            </div>
        </div>
    `;

    const ests = METRICAS.estados || {};
    const vCount = ests["VENCIDO"]?.productos || 0;
    const cCount = (ests["CRÍTICO"]?.productos || 0) + (ests["CRITICO"]?.productos || 0);
    const uCount = ests["URGENTE"]?.productos || 0;
    const totalRiesgo = vCount + cCount + uCount;
    const totalProductos = DATOS_CRUDOS.length;

    let diagColor = '#ef4444';
    let diagPulse = '#ef4444';
    let diagTexto = '';
    let diagStatus = 'ALERTA OPERATIVA';

    if (totalProductos === 0) {
        diagColor = '#10b981'; diagPulse = '#10b981'; diagStatus = 'ESTADO ÓPTIMO';
        diagTexto = 'Inventario en estado limpio. No se detectan anomalías operativas en el horizonte actual.';
    } else if (vCount === 0 && cCount === 0 && uCount === 0) {
        diagColor = '#10b981'; diagPulse = '#10b981'; diagStatus = 'SIN RIESGO';
        diagTexto = `✅ Los ${totalProductos} productos analizados se encuentran en estado NORMAL. No se requieren acciones inmediatas.`;
    } else {
        diagStatus = 'CRISIS DETECTADA';
        if (vCount > 0 && cCount > 0) {
            diagTexto = `Se detectaron <strong>${vCount} productos vencidos</strong> y <strong>${cCount} en estado crítico</strong>. Concentración de riesgo en ${totalRiesgo} lotes (${Math.round(totalRiesgo / totalProductos * 100)}% del inventario).`;
        } else if (vCount > 0) {
            diagColor = '#8b5cf6'; diagPulse = '#8b5cf6';
            diagTexto = `Se detectaron <strong>${vCount} productos vencidos</strong>. Su permanencia bloquea flujo de caja y genera riesgos sanitarios.`;
        } else if (cCount > 0) {
            diagColor = '#f97316'; diagPulse = '#f97316';
            diagTexto = `<strong>${cCount} productos en estado crítico</strong>. Se recomienda liquidación mediante Packs Estratégicos para minimizar pérdida.`;
        }
    }

    html += `
        <div style="margin-bottom:2.5rem; padding:1.5rem; background:#f8fafc; border:1px solid #e2e8f0; border-radius:16px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
                <div style="width:10px; height:10px; background:${diagPulse}; border-radius:50%; box-shadow:0 0 10px ${diagPulse}; animation: pulse 1.5s infinite;"></div>
                <span style="font-size:0.75rem; color:#64748b; font-weight:800; text-transform:uppercase; letter-spacing:1px;">${diagStatus}</span>
            </div>
            <p style="margin:0; font-size:1rem; line-height:1.6; color:#334155; font-weight:500;">
                ${diagTexto}
            </p>
        </div>
    `;

    window.ULTIMAS_RECOMENDACIONES = recomendaciones || [];
    html += `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap:1.5rem; position:relative; z-index:2;">`;

    // 1. RECOMENDACIONES ESTRATÉGICAS (IA)
    if (recomendaciones && recomendaciones.length > 0) {
        recomendaciones.forEach((rec) => {
            const impactColor = rec.impacto === "Alto" ? "#059669" : (rec.impacto === "Medio" ? "#d97706" : "#64748b");
            html += `
                <div class="ia-insight" style="display:flex; flex-direction:column; background:#f8fafc; padding:1.5rem; border-radius:16px; border:1px solid #e2e8f0; box-shadow:0 10px 15px -3px rgba(0,0,0,0.04); border-top:5px solid ${impactColor}; height:100%;">
                    <div style="flex:1;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                            <div style="font-size:0.65rem; color:${impactColor}; font-weight:800; text-transform:uppercase; letter-spacing:1px; background:${impactColor}15; padding:4px 10px; border-radius:100px;">
                                ⭐ Plan de Acción Táctico
                            </div>
                            <span style="font-size:0.7rem; color:#94a3b8; font-weight:700;">${rec.impacto} Impacto</span>
                        </div>
                        <h4 style="margin:0 0 10px 0; font-size:1.1rem; color:#1e293b; font-weight:800; line-height:1.4;">${rec.accion}</h4>
                        <p style="margin:0 0 16px 0; color:#475569; font-size:0.9rem; line-height:1.6;">${rec.descripcion}</p>
                    </div>
                    ${rec.por_que ? `
                    <div style="background:#f8fafc; padding:12px 14px; border-radius:12px; border:1px solid #e2e8f0; font-size:0.83rem; color:#475569; position:relative; overflow:hidden;">
                        <div style="position:absolute; left:0; top:0; bottom:0; width:3px; background:${impactColor}; opacity:0.6;"></div>
                        <strong style="color:${impactColor}">Racional:</strong> ${rec.por_que}
                    </div>` : ''}
                </div>
            `;
        });
    }

    // 2. HALLAZGOS ESTRATÉGICOS Y ANOMALÍAS DE INTEGRIDAD
    const insights = METRICAS.insights || [];
    const tieneAnomalias = insights.some(ins => {
        const text = (typeof ins === 'string' ? ins : (ins.desc || ins.descripcion || "")).toUpperCase();
        return text.includes("NEGATIVO") || text.includes("ERROR") || text.includes("DESCALCE");
    });

    if (tieneAnomalias) {
        html += `
            <div style="background: #fef2f2; border: 1px solid #fee2e2; border-radius: 12px; padding: 1.25rem; margin-top: 1rem;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                    <span style="font-size: 1.1rem;">⚠️</span>
                    <span style="font-size: 0.75rem; color: #991b1b; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Protocolo de Integridad de Datos</span>
                </div>
        `;

        insights.forEach(ins => {
            const desc = typeof ins === 'string' ? ins : (ins.desc || ins.descripcion || "");
            const text = desc.toUpperCase();

            if (text.includes("NEGATIVO")) {
                html += `
                    <div style="margin-bottom: 0px;">
                        <p style="margin:0; color:#b91c1c; font-size:0.9rem; font-weight:700; line-height:1.4;">Detección de Stock Inconsistente</p>
                        <p style="margin:4px 0 0 0; color:#7f1d1d; font-size:0.82rem; line-height:1.5; opacity:0.8;">
                            ${desc}. <strong>Acción Sugerida:</strong> Se requiere auditoría física inmediata en las sucursales afectadas para corregir descalces contables.
                        </p>
                    </div>
                `;
            }
        });

        html += `</div>`;
    }

    // Nota informativa de cobertura si no hay recomendaciones
    if (!recomendaciones?.length && !tieneAnomalias) {
        html += `
            <div style="text-align:center; padding: 4rem 1rem; opacity: 0.5;">
                <div style="background: #f1f5f9; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem;">
                    <span style="font-size: 1.8rem;">🛡️</span>
                </div>
                <h4 style="color:#1e293b; margin: 0 0 8px 0; font-weight: 700;">Operación Blindada</h4>
                <p style="font-size: 0.85rem; line-height:1.5; color:#475569;">El motor de IA ha escaneado la totalidad del inventario.<br>No se detectan fugas de capital ni riesgos críticos activos.</p>
            </div>
        `;
    }

    // Pie de Framework
    const dataPoints = totalProductos * 7; // aproximado: campos por producto
    const now = new Date().toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    html += `
        <div style="margin-top:3rem; padding:1.5rem; border-radius:16px; background:#f1f5f9; border:1px solid #e2e8f0;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                <h5 style="margin:0; font-size:0.8rem; color:#6366f1; text-transform:uppercase; letter-spacing:1.5px; font-weight:800;">Resumen del Asistente Digital</h5>
            </div>
            <p style="margin:0; font-size:0.82rem; color:#64748b; line-height:1.6;">
                Reporte generado analizando <strong style="color:#1e293b">${dataPoints.toLocaleString('es-CL')}</strong> puntos de datos operativos de <strong style="color:#1e293b">${totalProductos}</strong> productos. <span style="opacity:0.6">Actualizado: ${now}.</span>
            </p>
        </div>
    `;

    cardEl.innerHTML = html;
}

// Resaltar una recomendación específica al pulsar el botón de la tarjeta
window.highlightIARecommendation = function (estado) {
    const cardEl = document.querySelector(".ia-card");
    if (!cardEl) return;

    // Buscar el insight que contenga el estado o la categoría
    const insights = cardEl.querySelectorAll(".ia-insight");
    insights.forEach(ins => {
        const h5 = ins.querySelector("h5");
        const h4 = ins.querySelector("h4");
        const text = (h5?.textContent || h4?.textContent || "").toUpperCase();

        if (text.includes(estado.toUpperCase()) || (estado === "CRÍTICO" && text.includes("CRITICO"))) {
            ins.style.transition = "all 0.5s";
            ins.style.transform = "scale(1.02)";
            ins.style.boxShadow = "0 0 20px rgba(168, 85, 247, 0.4)";
            ins.style.borderColor = "#fff";

            setTimeout(() => {
                ins.style.transform = "scale(1)";
                ins.style.boxShadow = "none";
                ins.style.borderColor = "transparent";
            }, 3000);
        }
    });
}
window.ejecutarOptimizacionIA = function () {
    if (!window.SENSIBILIDAD_ACTUAL) {
        showToast("No hay datos de sensibilidad para optimizar.", "warning");
        return;
    }

    const sens = window.SENSIBILIDAD_ACTUAL;
    const itemsPre = sens.escenario_preventivo?.lotes_afectados || 0;
    const itemsUrg = sens.escenario_urgente?.lotes_afectados || 0;
    const hasCri = (sens.riesgo_critico_inminente || 0) > 0;
    const venCount = sens.vencidos?.cantidad || 0;
    const totalRecuperable = (sens.escenario_preventivo?.recuperacion_estimada || 0) + (sens.escenario_urgente?.recuperacion_estimada || 0);

    let itemsHtml = "";
    if (venCount > 0) itemsHtml += `<li><strong>Expirados (Vencidos):</strong> Sanear ${venCount} lotes (Retiro inmediato).</li>`;
    if (itemsPre > 0) itemsHtml += `<li><strong>Preventivo:</strong> -15% aplicado a ${itemsPre} lotes.</li>`;
    if (itemsUrg > 0) itemsHtml += `<li><strong>Urgente:</strong> -30% aplicado a ${itemsUrg} lotes.</li>`;
    if (hasCri) itemsHtml += `<li><strong>Estado Crítico:</strong> Priorizar donación inmediata.</li>`;

    if (itemsHtml === "") {
        showToast("No hay productos en categorías de riesgo para optimizar.", "info");
        return;
    }

    const msg = `
        <div style="text-align:left; font-size:0.9rem;">
            <p><strong>SIMULACIÓN DE OPTIMIZACIÓN:</strong></p>
            <ul style="padding-left:1.2rem; margin:10px 0;">
                ${itemsHtml}
            </ul>
            <p style="color:#10b981; font-weight:700;">Recuperación estimada: ${formatCLP(totalRecuperable)}</p>
            <p style="font-size:0.75rem; color:#64748b; margin-top:10px;">¿Desea aplicar estas políticas de precio a todo el inventario filtrado?</p>
        </div>
    `;

    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: '⚡ Optimizador Estratégico',
            html: msg,
            icon: 'info',
            showCancelButton: true,
            confirmButtonText: 'Aplicar Estrategia',
            cancelButtonText: 'Revisar Detalle',
            confirmButtonColor: '#9333ea'
        }).then((result) => {
            if (result.isConfirmed) {
                window.IA_PLAN_ACCION_GLOBAL_APLICADO = true;
                showToast("Estrategia aplicada a todo el inventario.", "success");
                renderizarIndicadores(); // ACTULIZA EL RESUMEN ARRIBA
                renderizarTabla(DATOS_CRUDOS); // Refrescar para mover los estados visuales
                if (window.ULTIMAS_RECOMENDACIONES) {
                    renderRecomendacionesIA(window.ULTIMAS_RECOMENDACIONES);
                }
            }
        });
    } else {
        showToast(`Iniciando optimización por ${formatCLP(totalRecuperable)}...`, "info");
    }
}

window.ejecutarDonacionDesdeIA = async function (accion, btnEl) {
    // Si la acción explícitamente habla de múltiples elementos o no logramos extraer un nombre claro
    const esGlobal = accion.toLowerCase().includes("productos") ||
        accion.toLowerCase().includes("lotes") ||
        accion.toLowerCase().includes("inventario") ||
        (!accion.toLowerCase().includes(" de ") && !accion.toLowerCase().includes(" a "));

    if (esGlobal) {
        window.ejecutarOptimizacionIA();
        return;
    }

    const match = accion.match(/a (.*)$/) || accion.match(/de (.*)$/);
    if (!match) return;
    const nombreProd = match[1];

    // Buscar el producto en DATOS_CRUDOS
    const prod = DATOS_CRUDOS.find(p => p.nombre_producto.toLowerCase().includes(nombreProd.toLowerCase()) || nombreProd.toLowerCase().includes(p.nombre_producto.toLowerCase()));

    if (!prod) {
        showToast("No se pudo identificar el producto exacto para donar.", "error");
        return;
    }

    window.abrirDonationModal(prod.id_producto, prod.nombre_producto, prod.cantidad_stock, btnEl);
}

window.tratamientoActual = { idProducto: null, nombreProd: null, stockActual: null, btnEl: null };

window.actualizarVistaTratamiento = function () {
    if (!window.tratamientoActual || !window.tratamientoActual.nombreProd) return;
    const { stockActual } = window.tratamientoActual;

    const qD = Math.max(0, parseInt(document.getElementById("qtyDonar").value) || 0);
    const qR = Math.max(0, parseInt(document.getElementById("qtyReciclar").value) || 0);
    const qE = Math.max(0, parseInt(document.getElementById("qtyEliminar").value) || 0);

    const totalSelected = qD + qR + qE;

    // Check if total config is over total stock
    const isOverload = totalSelected > stockActual;
    const stockVisual = document.getElementById("modalProductStock");
    if (stockVisual) {
        stockVisual.style.color = isOverload ? "#ef4444" : "#0f172a";
    }

    const details = document.getElementById("donationDetails");
    if (!details) return;

    const envImpactD = qD * APP_CONFIG.CO2_KG_POR_UNIDAD;
    const envImpactR = qR * APP_CONFIG.CO2_KG_POR_UNIDAD;
    const totalEnv = envImpactD + envImpactR;

    const socImpact = Math.round(qD * APP_CONFIG.RACIONES_POR_UNIDAD);

    details.innerHTML = `
        <div class="preview-item">
            <span class="preview-label">Total Distribuido / Disponible</span>
            <span class="preview-value" style="font-weight:600; color: ${isOverload ? '#ef4444' : '#1e293b'};">${totalSelected.toLocaleString('es-CL')} / ${stockActual.toLocaleString('es-CL')} uds</span>
        </div>
        <div class="preview-item" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #e2e8f0;">
            <span class="preview-label">Impacto Ambiental Estimado</span>
            <span class="preview-value" style="color: #059669; font-weight: 600;">🌱 +${totalEnv.toFixed(1)} kg CO2 evitado</span>
        </div>
        <div class="preview-item">
            <span class="preview-label">Impacto Social Estimado</span>
            <span class="preview-value" style="color: #10b981; font-weight: 600;">🥣 ~${socImpact} raciones</span>
        </div>
        ${isOverload ? `<div style="color: #ef4444; font-size: 0.85rem; padding: 0.5rem; background: #fef2f2; border-radius: 6px; margin-top: 1rem;">⚠️ La cantidad a tratar supera el stock disponible.</div>` : ''}
    `;

    const confirmBtn = document.getElementById("btnConfirmarDonacion");
    if (confirmBtn) {
        confirmBtn.disabled = isOverload || totalSelected === 0;
    }
};

window.abrirDonationModal = function (idProducto, nombreProd, stockActual, btnEl) {
    const modal = document.getElementById("donationModal");
    const confirmBtn = document.getElementById("btnConfirmarDonacion");

    if (!modal || !confirmBtn) return;

    window.tratamientoActual = { idProducto, nombreProd, stockActual, btnEl };

    const nameEl = document.getElementById("modalProductName");
    if (nameEl) nameEl.innerText = nombreProd;
    const stockEl = document.getElementById("modalProductStock");
    if (stockEl) stockEl.innerText = stockActual.toLocaleString('es-CL');

    document.getElementById("qtyDonar").value = "";
    document.getElementById("qtyReciclar").value = "";
    document.getElementById("qtyEliminar").value = "";
    document.getElementById("destDonar").value = "";
    document.getElementById("destReciclar").value = "";
    document.getElementById("destEliminar").value = "";

    window.actualizarVistaTratamiento();

    modal.classList.add("active");

    confirmBtn.innerHTML = "Procesar Cantidades";
    confirmBtn.style.background = "";

    confirmBtn.onclick = async () => {
        const qD = Math.max(0, parseInt(document.getElementById("qtyDonar").value) || 0);
        const qR = Math.max(0, parseInt(document.getElementById("qtyReciclar").value) || 0);
        const qE = Math.max(0, parseInt(document.getElementById("qtyEliminar").value) || 0);

        const orgD = document.getElementById("destDonar").value || APP_CONFIG.DESTINO_DEFAULT_DONAR;
        const orgR = document.getElementById("destReciclar").value || APP_CONFIG.DESTINO_DEFAULT_RECICLAR;
        const orgE = document.getElementById("destEliminar").value || APP_CONFIG.DESTINO_DEFAULT_ELIMINAR;

        confirmBtn.disabled = true;
        confirmBtn.innerHTML = "Procesando...";

        let finalSuccess = true;

        if (qD > 0) {
            const exito = await procesarDonacion(idProducto, nombreProd, qD, orgD, "Donar", btnEl, true);
            if (!exito) finalSuccess = false;
        }

        if (qR > 0) {
            const exito = await procesarDonacion(idProducto, nombreProd, qR, orgR, "Reciclar", btnEl, true);
            if (!exito) finalSuccess = false;
        }

        if (qE > 0) {
            const exito = await procesarDonacion(idProducto, nombreProd, qE, orgE, "Eliminar", btnEl, true);
            if (!exito) finalSuccess = false;
        }

        if (finalSuccess) {
            confirmBtn.innerHTML = "¡Completado! ✅";
            confirmBtn.style.background = "#059669";
            setTimeout(() => {
                cerrarDonationModal();
                inicializarTablero();
            }, 800);
        } else {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = "Error Parcial - Intentar de Nuevo";
            inicializarTablero();
        }
    };
}

window.cerrarDonationModal = function () {
    const modal = document.getElementById("donationModal");
    if (modal) modal.classList.remove("active");
}

async function procesarDonacion(idProducto, nombreProd, stockActual, organizacion, accion, btnEl, skipReload = false) {
    const originalContent = btnEl.innerHTML;
    btnEl.innerHTML = `<span class="loader" style="width:12px; height:12px; border-width:2px; display:inline-block; margin-right:5px;"></span>...`;
    btnEl.disabled = true;

    try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_URL}/api/donations`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                id_producto: idProducto,
                cantidad: stockActual,
                organizacion: organizacion,
                accion: accion
            })
        });

        if (res.ok) {
            btnEl.innerHTML = "TRATADO ✅";
            btnEl.style.background = "#059669";
            btnEl.style.color = "#ffffff";
            DONACIONES_RECIENTES.add(idProducto);
            showToast(`¡${accion.toLowerCase()} ${stockActual} uds de ${nombreProd}!`, "success");

            // Actualización visual inmediata local
            DATOS_CRUDOS = DATOS_CRUDOS.filter(i => String(i.id_producto) !== String(idProducto) && String(i.id_unico) !== String(idProducto));
            window.actualizarInterfazLocal();

            // ── Re-análisis IA automático tras tratamiento ──
            if (window._reanalisisTimer) clearTimeout(window._reanalisisTimer);
            window._reanalisisTimer = setTimeout(() => {
                const h = parseInt(document.getElementById('horizonteRiesgo')?.value || 0);
                const mes = window._FILTRO_MES || null;
                const anio = window._FILTRO_ANIO || null;
                cargarRecomendacionesIA(mes, anio, h);
            }, APP_CONFIG.REANALISIS_DEBOUNCE_MS);

            if (!skipReload) {
                setTimeout(() => inicializarTablero(), 2000);
            }
            return true;
        } else {
            btnEl.innerHTML = originalContent;
            btnEl.disabled = false;
            showToast(`Error al procesar: ${accion}`, "error");
            return false;
        }
    } catch (err) {
        btnEl.innerHTML = originalContent;
        btnEl.disabled = false;
        showToast("Error de red", "error");
        return false;
    }
}

async function cargarImpactoSocial() {
    const parentArea = document.getElementById("impacto-social");
    if (!parentArea) return;

    try {
        const token = localStorage.getItem("token");
        const sessionFilter = window._analisisActivo || "";

        // 1. Cargar Metatricas de Impacto
        let urlImpact = `${API_URL}/api/donations/impact`;
        if (sessionFilter) urlImpact += `?fuente=${encodeURIComponent(sessionFilter)}`;

        const resStats = await fetch(urlImpact, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const stats = await resStats.json();

        if (document.getElementById("impact-total-ahorro")) {
            document.getElementById("impact-total-ahorro").textContent = formatCLP(stats.ahorro_total || 0);
        }
        document.getElementById("impact-total-value").textContent = formatCLP(stats.valor_total_donado || 0);
        document.getElementById("impact-total-co2").innerHTML = `${(stats.co2_evitado || 0).toFixed(1)} <small>kg</small>`;
        document.getElementById("impact-total-meals").textContent = Math.round(stats.raciones_entregadas || 0);

        // 2. Cargar historial limitado (primeros 100 para la vista rápida)
        let urlHist = `${API_URL}/api/donations?limit=100`;
        if (sessionFilter) urlHist += `&fuente=${encodeURIComponent(sessionFilter)}`;

        const resHist = await fetch(urlHist, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const donacionesPayload = await resHist.json();
        // El endpoint ahora devuelve { total, limit, items } para saber si hay más registros
        const donacionesRecientes = Array.isArray(donacionesPayload)
            ? donacionesPayload           // compatibilidad si algún proxy devuelve array
            : (donacionesPayload.items || []);
        const totalDonaciones = donacionesPayload.total ?? donacionesRecientes.length;

        // 2.5 Calcular Impacto Pendiente (Coherencia entre pestañas)
        const pendingSection = document.getElementById("pendingImpactSection");
        const pendingValueEl = document.getElementById("pending-impact-value");
        const pendingCo2El = document.getElementById("pending-impact-co2");

        const itemsRiesgo = DATOS_CRUDOS.filter(d => d.estado_alerta === "VENCIDO" || d.estado_alerta === "CRÍTICO");
        if (itemsRiesgo.length > 0 && pendingSection) {
            const valorP = itemsRiesgo.reduce((acc, curr) => acc + (curr.valor_stock || 0), 0);
            const co2P = itemsRiesgo.reduce((acc, curr) => acc + ((curr.cantidad_stock || 0) * 0.45), 0); // Factor de conversión CO2 aprox.

            pendingSection.style.display = "block";
            if (pendingValueEl) pendingValueEl.textContent = formatCLP(valorP);
            if (pendingCo2El) pendingCo2El.textContent = co2P.toFixed(1) + " kg";
        } else if (pendingSection) {
            pendingSection.style.display = "none";
        }

        // 3. Renderizado de Estado (vaciado o poblado)
        const tableArea = document.getElementById("tableAreaImpacto");

        if (donacionesRecientes.length === 0 && (stats.cantidad_acciones === 0 || stats.total_acciones === 0)) {
            if (tableArea) {
                tableArea.innerHTML = `
                <div style="text-align:center; padding:4rem 2rem; color:#94a3b8;">
                    <div style="font-size:4rem; margin-bottom:1rem; opacity:0.3;">🌱</div>
                    <h3 style="color:#1e293b; margin-bottom:0.5rem; font-weight:700;">Gestión de Impacto</h3>
                    <p style="font-size:0.9rem; max-width:400px; margin:0 auto;">Procesa planes de acción en la sección principal para registrar tus iniciativas ambientales y de donación social. Tus registros agrupados aparecerán aquí.</p>
                </div>`;
            }
            return;
        }

        // 3. Agrupamiento usando el DESGLOSE del SERVIDOR (Sin bucles pesados en JS)
        const gruposBase = {
            'DONACIÓN SOCIAL': { icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`, color: '#059669', bg: '#f0fdf4', items: [] },
            'RECUPERACIÓN / VENTA': { icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>`, color: '#1e40af', bg: '#eff6ff', items: [] },
            'MERMA / TRATAMIENTO': { icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`, color: '#be123c', bg: '#fff1f2', border: '#fecdd3', items: [] },
            'OTROS': { icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>`, color: '#475569', bg: '#f8fafc', items: [] }
        };

        const desgloseRaw = stats.desglose_por_categoria || {};
        const desgloseCat = {
            'DONACIÓN SOCIAL': { ahorro: 0, co2: 0, conteo: 0, valor: 0 },
            'RECUPERACIÓN / VENTA': { ahorro: 0, co2: 0, conteo: 0, valor: 0 },
            'MERMA / TRATAMIENTO': { ahorro: 0, co2: 0, conteo: 0, valor: 0 },
            'OTROS': { ahorro: 0, co2: 0, conteo: 0, valor: 0 }
        };

        // Homologar tipos específicos a grupos macro
        Object.entries(desgloseRaw).forEach(([tipo, d]) => {
            const t = (tipo || '').toLowerCase();
            let cat = 'OTROS';
            if (t.includes('donación') || t.includes('donar') || t.includes('social')) cat = 'DONACIÓN SOCIAL';
            else if (t.includes('venta') || t.includes('táctica') || t.includes('flash') || t.includes('rescate') || t.includes('oferta') || t.includes('liquidar') || t.includes('combo')) cat = 'RECUPERACIÓN / VENTA';
            else if (t.includes('merma') || t.includes('vencido') || t.includes('eliminar') || t.includes('desecho')) cat = 'MERMA / TRATAMIENTO';

            desgloseCat[cat].ahorro += d.ahorro;
            desgloseCat[cat].co2 += d.co2;
            desgloseCat[cat].conteo += d.conteo;
            desgloseCat[cat].valor += d.valor;
        });

        // 3.5 Actualizar KPIs de Merma y Recupero
        const mermaVal = desgloseCat['MERMA / TRATAMIENTO'].valor || 0;
        const ahorroVal = stats.ahorro_total || 0;
        const totalRiesgoCalculado = ahorroVal + mermaVal;
        const pctRecupero = totalRiesgoCalculado > 0 ? (ahorroVal / totalRiesgoCalculado) * 100 : 0;

        if (document.getElementById("impact-total-merma")) {
            document.getElementById("impact-total-merma").textContent = formatCLP(mermaVal);
        }
        if (document.getElementById("pct-recupero-label")) {
            document.getElementById("pct-recupero-label").textContent = `${pctRecupero.toFixed(1)}% del Riesgo Evitado`;
        }

        // Homologar historial reciente a grupos
        donacionesRecientes.forEach(d => {
            const t = (d.tipo_accion || '').toLowerCase();
            let cat = 'OTROS';
            if (t.includes('donación') || t.includes('donar') || t.includes('social')) cat = 'DONACIÓN SOCIAL';
            else if (t.includes('venta') || t.includes('táctica') || t.includes('flash') || t.includes('rescate') || t.includes('oferta') || t.includes('liquidar') || t.includes('combo')) cat = 'RECUPERACIÓN / VENTA';
            else if (t.includes('merma') || t.includes('vencido') || t.includes('eliminar') || t.includes('desecho')) cat = 'MERMA / TRATAMIENTO';
            gruposBase[cat].items.push(d);
        });

        let finalHtml = "";

        Object.entries(gruposBase).forEach(([nombre, cfg], idx) => {
            const meta = desgloseCat[nombre] || { ahorro: 0, co2: 0, conteo: 0 };
            if (meta.conteo === 0 && cfg.items.length === 0) return;

            // AGRUPACIÓN INTELIGENTE (Smart Grouping)
            // Esto fusionará iteraciones repetitivas del mismo producto/acción hacia el mismo canal
            const groupedMap = new Map();
            cfg.items.forEach(d => {
                const key = d.nombre_producto + '|' + (d.organizacion_receptora || 'G. Interna');
                if (!groupedMap.has(key)) {
                    groupedMap.set(key, {
                        ...d,
                        conteo_agrupado: 1,
                        cantidad_total: d.cantidad || 0,
                        ahorro_total: d.ahorro_estimado || 0,
                        fecha_reciente: d.fecha_donacion,
                        ids_originales: [d.id]
                    });
                } else {
                    const ag = groupedMap.get(key);
                    ag.conteo_agrupado++;
                    ag.cantidad_total += (d.cantidad || 0);
                    ag.ahorro_total += (d.ahorro_estimado || 0);
                    ag.ids_originales.push(d.id);
                    if (new Date(d.fecha_donacion) > new Date(ag.fecha_reciente)) ag.fecha_reciente = d.fecha_donacion;
                }
            });
            const items = Array.from(groupedMap.values()).sort((a, b) => new Date(b.fecha_reciente) - new Date(a.fecha_reciente)); // Ordenar por más reciente
            const grupoId = `cat-impacto-${idx}`;

            // Carpeta de Categoría
            finalHtml += `
            <div class="glass-card folder-category" style="margin-bottom: 2rem; border-left: 6px solid ${cfg.color}; padding: 0; overflow: hidden; background: white;">
                <div style="padding: 1.5rem; background: ${cfg.bg}; cursor: pointer; display: flex; justify-content: space-between; align-items: center;" 
                     onclick="toggleGrupoImpacto('${grupoId}')">
                    <div style="display: flex; align-items: center; gap: 1.25rem;">
                        <span style="font-size: 2.5rem;">${cfg.icon}</span>
                        <div>
                            <h3 style="margin: 0; color: ${cfg.color}; font-size: 1.25rem; font-weight: 800; text-transform: uppercase;">${nombre}</h3>
                            <p style="margin: 4px 0 0 0; color: #64748b; font-size: 0.85rem; font-weight: 600;">${items.length} registros consolidados</p>
                        </div>
                    </div>
                    <div style="display: flex; gap: 2rem; align-items: center;">
                         <div style="text-align: right;">
                            <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Recuperación</div>
                            <div style="color: ${cfg.color}; font-weight: 800; font-size: 1.1rem;">${formatCLP(meta.ahorro)}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Impacto Ambiental</div>
                            <div style="color: #059669; font-weight: 800; font-size: 1.1rem;">${meta.co2.toFixed(1)} <small>kg CO2</small></div>
                        </div>
                        <span id="icon-${grupoId}" style="font-size: 1.25rem; transition: transform 0.3s;">▼</span>
                    </div>
                </div>

                <div id="${grupoId}" style="display: none; padding: 0 1.5rem 1.5rem 1.5rem; max-height: 500px; overflow-y: auto; background:#f8fafc; border-top:1px solid #e2e8f0;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; margin-top: 1rem;">
                        ${items.map(d => `
                             <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem; box-shadow: 0 2px 4px rgba(0,0,0,0.02); transition: transform 0.2s, box-shadow 0.2s; position:relative; overflow:hidden;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 6px rgba(0,0,0,0.05)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.02)';">
                                 <div style="position:absolute; top:0; left:0; bottom:0; width:4px; background:${cfg.color};"></div>
                                 <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.85rem;">
                                     <div style="padding-left:0.5rem;">
                                         <h4 style="margin: 0; color: #1e293b; font-size: 0.95rem; font-weight: 800;">
                                             ${d.nombre_producto}
                                             ${d.conteo_agrupado > 1 ? `<span style="background: ${cfg.bg}; color: ${cfg.color}; font-size: 0.6rem; font-weight: 800; padding: 2px 8px; border-radius: 12px; margin-left: 6px; border: 1px solid ${cfg.color}40; letter-spacing:0.02em;">${d.conteo_agrupado} ACCIONES</span>` : ''}
                                         </h4>
                                         <p style="margin: 0.2rem 0 0 0; font-size: 0.65rem; color: #94a3b8; font-weight:700; text-transform:uppercase;">
                                             SKU: ${d.id_producto} &nbsp;•&nbsp; 📋 ${d.tipo_accion}
                                         </p>
                                     </div>
                                     <div style="display: flex; gap: 4px; align-items: center;">
                                         <button onclick="window.descargarCSVDetalleTactica('${d.ids_originales.join(',')}')"
                                            title="Descargar detalle en CSV"
                                            style="background: white; border: 1px solid #cbd5e1; color: #64748b; padding: 4px 6px; border-radius: 8px; cursor: pointer; font-size: 0.8rem; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"
                                            onmouseover="this.style.borderColor='${cfg.color}'; this.style.color='${cfg.color}'; this.style.background='${cfg.bg}';"
                                            onmouseout="this.style.borderColor='#cbd5e1'; this.style.color='#64748b'; this.style.background='white';">
                                            ⬇️
                                         </button>
                                         <button onclick="window.transferirRegistroSocial('${d.ids_originales.join(',')}', '${d.nombre_producto}')" 
                                                 style="background: white; border: 1px solid #cbd5e1; color: #64748b; padding: 4px 10px; border-radius: 8px; font-size: 0.6rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s;"
                                                 onmouseover="this.style.borderColor='${cfg.color}'; this.style.color='${cfg.color}'; this.style.background='${cfg.bg}';"
                                                 onmouseout="this.style.borderColor='#cbd5e1'; this.style.color='#64748b'; this.style.background='white';">
                                             🔄 Transferir
                                         </button>
                                     </div>
                                 </div>
                                 
                                 <div style="display: flex; gap: 0.75rem; margin-bottom: 0.85rem; padding-left:0.5rem;">
                                     <div style="background: #f1f5f9; padding: 0.5rem 0.75rem; border-radius: 8px; flex: 1;">
                                         <p style="margin: 0; font-size: 0.65rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Unidades</p>
                                         <p style="margin: 0; font-size: 0.95rem; color: #334155; font-weight: 800;">${(d.cantidad_total || 0).toLocaleString('es-CL')}</p>
                                     </div>
                                     <div style="background: ${cfg.bg}; padding: 0.5rem 0.75rem; border-radius: 8px; flex: 1; border: 1px solid ${cfg.color}30;">
                                         <p style="margin: 0; font-size: 0.65rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Ahorro/Recuperación</p>
                                         <p style="margin: 0; font-size: 0.95rem; color: ${cfg.color}; font-weight: 900;">${formatCLP(d.ahorro_total || 0)}</p>
                                     </div>
                                 </div>
                                 
                                 <!-- Proveedor y sucursal de origen -->
                                 ${(d.proveedor || d.nombre_ubicacion) ? `
                                 <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.4rem; padding-left:0.5rem; margin-bottom: 0.4rem;">
                                     ${d.proveedor ? `
                                     <span style="display:inline-flex; align-items:center; gap:3px; font-size:0.6rem; font-weight:600; color:#7c3aed; background:#f5f3ff; border:1px solid #ddd6fe; padding:2px 8px; border-radius:6px;">
                                         🏭 ${d.proveedor}
                                     </span>` : ''}
                                     ${d.nombre_ubicacion ? `
                                     <span style="display:inline-flex; align-items:center; gap:3px; font-size:0.6rem; font-weight:600; color:#0369a1; background:#f0f9ff; border:1px solid #bae6fd; padding:2px 8px; border-radius:6px;">
                                         📍 ${d.nombre_ubicacion}
                                     </span>` : ''}
                                 </div>` : ''}
                                 <!-- Destino + fecha -->
                                 <div style="font-size: 0.75rem; color: #475569; display: flex; align-items: center; justify-content: space-between; background:#f8fafc; padding:8px 10px; border-radius:8px; border:1px solid #e2e8f0; margin-left:0.5rem;">
                                     <div style="display: flex; align-items: center; gap: 0.5rem;">
                                         <span>🏛️</span>
                                         <span style="font-weight: 700; color:#334155;">Destino:</span> 
                                         <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:120px;" title="${d.organizacion_receptora || 'Gestión Interna'}">${d.organizacion_receptora || 'Gestión Interna'}</span>
                                     </div>
                                     <span style="font-size: 0.6rem; color: #94a3b8; font-weight: 600;">
                                         📅 ${new Date(d.fecha_reciente).toLocaleDateString()}
                                     </span>
                                 </div>
                             </div>
                        `).join('')}
                    </div>

                    <!-- CSV download si hay más registros que el límite mostrado -->
                    ${totalDonaciones > 100 ? `
                        <div style="margin-top:1rem; display:flex; align-items:center; justify-content:space-between; background:#f1f5f9; padding:0.85rem 1.2rem; border-radius:10px; border:1px solid #e2e8f0;">
                            <span style="font-size:0.8rem; color:#475569; font-weight:600;">
                                📊 Mostrando 100 de <strong>${totalDonaciones}</strong> registros totales
                            </span>
                            <a href="${API_URL}/api/donations/csv${sessionFilter ? '?fuente=' + encodeURIComponent(sessionFilter) : ''}" 
                               target="_blank"
                               style="display:inline-flex; align-items:center; gap:6px; background:#1e40af; color:white; padding:6px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; text-decoration:none; transition:background 0.2s;"
                               onmouseover="this.style.background='#1e3a8a'" onmouseout="this.style.background='#1e40af'">
                                ⬇️ Descargar CSV completo
                            </a>
                        </div>
                    ` : ''}
                </div>
            </div>`;
        });

        // Reemplazar TODA la zona de la tabla con el nuevo sistema de carpetas
        if (tableArea) {
            tableArea.style.background = "transparent";
            tableArea.style.border = "none";
            tableArea.style.padding = "0";
            tableArea.innerHTML = `
                <h3 style="margin: 2rem 0 1.5rem 0; color: #1f2937; display: flex; align-items: center; gap: 0.75rem; font-weight: 800;">
                    <span>📂</span> Registro de Acciones Agrupadas (Categoría)
                </h3>
                ${finalHtml}
            `;
        }

    } catch (err) {
        console.error("Error cargando impacto:", err);
    }
}

// Función Global corregida para colapsar categorías
window.toggleGrupoImpacto = function (id) {
    const el = document.getElementById(id);
    const icon = document.getElementById(`icon-${id}`);
    if (el) {
        if (el.style.display === "none") {
            el.style.display = "block";
            if (icon) icon.style.transform = "rotate(180deg)";
        } else {
            el.style.display = "none";
            if (icon) icon.style.transform = "rotate(0deg)";
        }
    }
};

window.limpiarHistorialImpacto = async function () {
    const sessionFilter = window._analisisActivo || "";
    const isPartial = !!sessionFilter;

    const { isConfirmed } = await Swal.fire({
        title: isPartial ? `¿Limpiar Sesión "${sessionFilter}"?` : "¿Limpiar Historial Global?",
        html: isPartial
            ? `Se eliminarán los registros de <strong>esta sesión específica</strong>.<br>El stock de estos productos será restaurado.`
            : "Se eliminarán <strong>todos</strong> los registros comerciales y de sostenibilidad.<br>El inventario total volverá a su estado original.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#be123c",
        confirmButtonText: isPartial ? "Sí, limpiar sesión" : "Sí, limpiar todo",
        cancelButtonText: "Cancelar"
    });

    if (isConfirmed) {
        // Mostrar progreso adaptado al tipo de limpieza
        Swal.fire({
            title: isPartial ? 'Restaurando Sesión...' : 'Restaurando Todo el Inventario...',
            html: isPartial
                ? 'Calculando y devolviendo stock a la base de datos...'
                : 'Reconstruyendo el stock desde los archivos originales. Esto puede tomar unos segundos.',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            const token = localStorage.getItem("token");
            const sessionFilter = window._analisisActivo || "";

            let url = `${API_URL}/api/donations/clear_all`;
            const params = new URLSearchParams();
            if (sessionFilter) params.set("fuente", sessionFilter);
            // Enviar el análisis activo para que el backend re-consolide solo sus archivos
            if (_analisisActivo) params.set("analisis_id", _analisisActivo);
            if ([...params].length > 0) url += `?${params.toString()}`;

            const res = await fetch(url, {
                method: "DELETE",
                headers: { "Authorization": `Bearer ${token}` }
            });

            if (res.ok) {
                // Limpiar estado local de sesión también
                DONACIONES_RECIENTES.clear();
                TACTICAS_APLICADAS.clear();
                window._guardarPersistenciaTacticas();

                Swal.fire({
                    title: '✅ Historial Limpiado',
                    html: 'El inventario fue <strong>restaurado a su estado original</strong>.<br>Los stocks han vuelto a sus valores iniciales.',
                    icon: 'success',
                    confirmButtonColor: '#10b981',
                    confirmButtonText: 'Ver Inventario',
                    timer: 3500,
                    timerProgressBar: true
                }).then(() => {
                    // Navegar al tablero principal y recargar la página para limpiar estados profundos
                    localStorage.setItem("ultima_pestaña", "control-maestro");
                    window.location.reload();
                });

                // Limpiar referencia local inmediata
                DATOS_CRUDOS = [];
                window.actualizarInterfazLocal();

                // Recargar tablero en background (ya arrancó el timer del Swal)
                await inicializarTablero();
                await cargarImpactoSocial();

            } else {
                const err = await res.json().catch(() => ({}));
                Swal.fire('Error', err.detail || 'No se pudo limpiar el historial.', 'error');
            }
        } catch (err) {
            Swal.fire('Error de conexión', err.message || 'No se pudo conectar al servidor.', 'error');
        }
    }
};


window.transferirRegistroSocial = async function (idsRaw, nombre) {
    const ids = idsRaw.split(',');
    const { value: nuevaCat } = await Swal.fire({
        title: `Reclasificar Impacto: ${nombre}`,
        html: `¿A qué categoría estratégica deseas mover este registro?<br><small style="color:#64748b;">Esto actualizará las métricas de ahorro e impacto ambiental automáticamente.</small>`,
        input: 'select',
        inputOptions: {
            'DONACIÓN SOCIAL': 'DONACIÓN SOCIAL (Alta ración, Alto CO2)',
            'RECUPERACIÓN / VENTA': 'RECUPERACIÓN / VENTA (Flujo de Caja)',
            'MERMA / TRATAMIENTO': 'MERMA / TRATAMIENTO (Desecho Controlado)'
        },
        inputPlaceholder: 'Selecciona nueva categoría',
        showCancelButton: true,
        confirmButtonText: 'Transferir Registro',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#3b82f6',
        cancelButtonColor: '#94a3b8'
    });

    if (nuevaCat) {
        Swal.fire({
            title: 'Actualizando registros...',
            html: 'Buscando artículos vinculados y recalculando impacto...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const token = localStorage.getItem("token");
        try {
            // Actualizar cada registro en paralelo
            const responses = await Promise.all(ids.map(id =>
                fetch(`${API_URL}/api/donations/${id}/type`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ tipo_accion: nuevaCat })
                })
            ));

            if (responses.every(r => r.ok)) {
                await Swal.fire({
                    title: '✅ Reclasificación Exitosa',
                    text: `"${nombre}" ahora forma parte de ${nuevaCat}.`,
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });
                await cargarImpactoSocial();
            } else {
                throw new Error("Algunos registros no pudieron actualizarse.");
            }
        } catch (err) {
            Swal.fire('Error', err.message || 'No se pudo completar la transferencia.', 'error');
        }
    }
}

window.descargarCSVDetalleTactica = async function (idsRaw) {
    const token = localStorage.getItem("token");
    if (!token) {
        Swal.fire('Error', 'No estás autenticado.', 'error');
        return;
    }

    try {
        Swal.fire({
            title: 'Preparando archivo...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const res = await fetch(`${API_URL}/api/donations/tactics/csv?ids=${idsRaw}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!res.ok) {
            throw new Error('No se pudo generar el CSV.');
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `detalle_tactica_ia_${idsRaw.split(',')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);

        Swal.close();
    } catch (err) {
        console.error("Error descargando CSV:", err);
        Swal.fire('Error', 'Ocurrió un problema al descargar el archivo.', 'error');
    }
}

window.descargarEstrategiaCSV = async function (tipo) {
    Swal.fire({
        title: 'Generando Reporte...',
        text: 'Filtrando trazabilidad de estrategias aplicadas.',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    try {
        const token = localStorage.getItem("token");
        const sessionFilter = window._analisisActivo || "";
        let url = `${API_URL}/api/donations?limit=10000`; // Traer todo lo posible de la sesión
        if (sessionFilter) url += `&fuente=${encodeURIComponent(sessionFilter)}`;

        const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
        const payload = await res.json();
        const fullItems = Array.isArray(payload) ? payload : (payload.items || []);

        let filtered = [];
        let filename = 'reporte_estrategia.csv';

        if (tipo === 'descuento') {
            filtered = fullItems.filter(i => {
                const t = (i.tipo_accion || '').toLowerCase();
                return t.includes('venta') || t.includes('táctica') || t.includes('flash') || t.includes('liquidar') || t.includes('precio') || t.includes('descuento');
            });
            filename = 'estrategia_descuentos_aplicados.csv';
        } else if (tipo === 'pack') {
            filtered = fullItems.filter(i => (i.tipo_accion || '').toLowerCase().includes('pack') || (i.tipo_accion || '').toLowerCase().includes('combo'));
            filename = 'estrategia_packs_productos.csv';
        } else if (tipo === 'donacion') {
            filtered = fullItems.filter(i => (i.tipo_accion || '').toLowerCase().includes('donación') || (i.tipo_accion || '').toLowerCase().includes('social'));
            filename = 'reporte_donaciones_tributario.csv';
        } else if (tipo === 'movimiento') {
            filtered = fullItems.filter(i => (i.tipo_accion || '').toLowerCase().includes('relocalizar') || (i.tipo_accion || '').toLowerCase().includes('movimiento') || (i.tipo_accion || '').toLowerCase().includes('frente'));
            filename = 'trazabilidad_movimientos_gondola.csv';
        }

        if (filtered.length === 0) {
            Swal.fire('Sin Datos', 'No se encontraron acciones aplicadas para esta categoría en la sesión actual.', 'info');
            return;
        }

        // Generar CSV localmente
        const headers = ["Fecha", "Producto", "Categoría", "Acción", "Cantidad", "Valor Stock", "Impacto Económico/Social", "Referencia"];
        const rows = filtered.map(i => [
            new Date(i.fecha_donacion).toLocaleString('es-CL'),
            i.nombre_producto,
            i.categoria || 'N/A',
            i.tipo_accion,
            i.cantidad,
            i.valor_stock,
            i.ahorro_estimado,
            i.organizacion_receptora || 'Gestión Interna'
        ]);

        let csvContent = "\ufeff" + headers.join(";") + "\n";
        rows.forEach(row => {
            csvContent += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(";") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const urlObj = URL.createObjectURL(blob);
        link.setAttribute("href", urlObj);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        Swal.fire({
            icon: 'success',
            title: 'CSV Generado',
            text: `Se han exportado ${filtered.length} registros exitosamente.`,
            timer: 2000
        });
    } catch (err) {
        console.error("Error reporte tactico:", err);
        Swal.fire('Error', 'No se pudo generar el reporte táctico.', 'error');
    }
}


window.descargarCertificadoPDF = function () {
    const originalTitle = document.title;
    document.title = "Certificado_Impacto_Sostenibilidad_" + new Date().toISOString().split('T')[0];
    window.print();
    document.title = originalTitle;
}

window.ejecutarDonacionManual = function (idProducto, nombreProd, stockActual, btnEl) {
    console.debug("🛠️ Ejecutando donación manual para ID:", idProducto);
    // Si faltan datos o vienen vacíos, buscarlos en el global de datos crudos
    if (!nombreProd || !stockActual || stockActual === 0) {
        // Buscar por id_producto o id_unico indistintamente
        const item = window.DATOS_CRUDOS.find(i =>
            String(i.id_producto) === String(idProducto) ||
            String(i.id_unico) === String(idProducto)
        );
        if (item) {
            nombreProd = item.nombre_producto;
            stockActual = item.cantidad_stock;
        }
    }
    if (typeof window.abrirDonationModal === 'function') {
        window.abrirDonationModal(idProducto, nombreProd || 'Producto', stockActual || 0, btnEl);
    } else {
        console.error("❌ error: abrirDonationModal no encontrada");
    }
}

// Helpers para eventos en HTML inyectado (evitan problemas de comillas)
window.tratarProductoDesdeUI = function (btn) {
    const id = btn.getAttribute('data-id');
    if (id) window.ejecutarDonacionManual(id, '', 0, btn);
};

window.verTodosEstadoDesdeUI = function (el) {
    const estado = el.getAttribute('data-estado');
    if (estado) window.abrirDetalleCategoria('TODOS_EN_ESTADO', estado);
};

function formatMoney(amount) {
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
    if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Formato exacto sin abreviaciones: $10, $7.50, $1234.75
function fmtExact(v) {
    if (v == null) return '—';
    return `$${Math.round(Number(v)).toLocaleString('es-CL')}`;
}

function renderizarIndicadores() {
    const estados = METRICAS.estados || {};

    // Update "Hoy" and "Inicio" labels
    const hoyEl = document.getElementById("hoyLabel");

    // HU-CONSISTENCIA: Usar la fecha real del sistema (window.HOY) para que los cálculos 
    // de los cards y del horizonte coincidan 1:1 con la clasificación del backend.
    const hoyDate = window.HOY ? new Date(window.HOY + "T12:00:00") : new Date();
    if (hoyEl) {
        let msg = `Hoy: ${hoyDate.toLocaleDateString('es-CL')}`;
        // Si hay una fecha del dataset diferente a la del sistema, la mostramos como referencia.
        if (window.HOY_DATASET && window.HOY_DATASET !== window.HOY) {
            const dn = new Date(window.HOY_DATASET + "T12:00:00");
            msg += ` (Datos al: ${dn.toLocaleDateString('es-CL')})`;
        }
        hoyEl.textContent = msg;
    }

    const minFecha = METRICAS.min_fecha || LIMITES_FECHA.min;
    const inicioEl = document.getElementById("inicioLabel");
    const isStockout = window.TIPO_ANALISIS === "STOCKOUT";

    if (inicioEl && minFecha && !isStockout) {
        const d = new Date(minFecha);
        inicioEl.textContent = `Desde: ${d.toLocaleDateString('es-CL')}`;
    } else if (inicioEl) {
        inicioEl.textContent = isStockout ? "Gestión de Stock Activa" : "Historial Completo";
    }

    // Actualizar Fechas en Tarjetas de Riesgo
    const fmtFechaRel = (days) => {
        const target = new Date(hoyDate);
        target.setDate(target.getDate() + days);
        const day = target.getDate().toString().padStart(2, '0');
        const month = target.toLocaleDateString('es-CL', { month: 'short' }).toUpperCase();
        return `<span style="font-weight:900;">${day} ${month}</span>`;
    };


    const diasV = document.getElementById("dias-vencido");
    if (diasV) diasV.innerHTML = isStockout ? "Sin stock disponible" : `(Expirados al ${fmtFechaRel(0)})`;

    const diasC = document.getElementById("dias-critico");
    if (diasC) diasC.innerHTML = isStockout ? "0 a 3 días de autonomía" : `(${fmtFechaRel(1)} al ${fmtFechaRel(3)})`;

    const diasU = document.getElementById("dias-urgente");
    if (diasU) diasU.innerHTML = isStockout ? "4 a 7 días de autonomía" : `(${fmtFechaRel(4)} al ${fmtFechaRel(7)})`;

    const diasP = document.getElementById("dias-preventivo");
    if (diasP) diasP.innerHTML = isStockout ? "8 a 15 días de autonomía" : `(${fmtFechaRel(8)} al ${fmtFechaRel(10)})`;

    const diasN = document.getElementById("dias-normal");
    if (diasN) diasN.innerHTML = isStockout ? "Stock saludable (+15 días)" : `(Vence desde ${fmtFechaRel(11)})`;

    // Actualizar Títulos de las Tarjetas
    // Actualizar Títulos de las Tarjetas
    const titulosMap = {
        "vencido": isStockout ? "AGOTADO" : "VENCIDO",
        "critico": isStockout ? "QUIEBRE" : "CRÍTICO",
        "urgente": isStockout ? "REABASTECER" : "URGENTE",
        "preventivo": isStockout ? "MONITOREAR" : "PREVENTIVO",
        "normal": "SALUDABLE"
    };

    // Banner Update Removed (HTML removed)

    // Mapa de ids a claves del backend (con acentos correctos)
    const KEY_MAP = {
        "vencido": "VENCIDO",
        "critico": "CR\u00cdTICO",
        "urgente": "URGENTE",
        "preventivo": "PREVENTIVO",
        "normal": "NORMAL"
    };
    const ids = ["vencido", "critico", "urgente", "preventivo", "normal"];
    ids.forEach(id => {
        const key = KEY_MAP[id];
        const card = document.getElementById(`val-${id}-prod`)?.closest('.risk-card');
        if (!card) return;

        // HU-TITULOS: Cambiar texto del título según modo
        const titleEl = card.querySelector('.title');
        if (titleEl) titleEl.textContent = titulosMap[id];

        // HU-CONTEXTO: Cambiar 'valor en riesgo' por 'capital comprometido' si es stockout
        const footerLabel = card.querySelector('.metric-footer .label');
        if (footerLabel && isStockout) {
            footerLabel.textContent = "capital comprometido";
        } else if (footerLabel) {
            footerLabel.textContent = "valor en riesgo";
        }

        // Visualización de selección
        if (window.SELECCION_ESTADOS_RIESGO?.has(key)) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }

        // Listener de selección (HU: Power BI style)
        if (!card.dataset.listener) {
            card.addEventListener('click', () => {
                if (!window.SELECCION_ESTADOS_RIESGO) window.SELECCION_ESTADOS_RIESGO = new Set();
                if (window.SELECCION_ESTADOS_RIESGO.has(key)) {
                    window.SELECCION_ESTADOS_RIESGO.delete(key);
                } else {
                    window.SELECCION_ESTADOS_RIESGO.add(key);
                }
                // Actualizar UI
                const grid = card.closest('.risk-cards-container');
                if (grid) {
                    if (window.SELECCION_ESTADOS_RIESGO.size > 0) grid.classList.add('has-selection');
                    else grid.classList.remove('has-selection');
                }
                renderizarIndicadores(); // Re-render para actualizar totales
            });
            card.dataset.listener = "true";
        }

        const prodEl = document.getElementById(`val-${id}-prod`);
        const unidEl = document.getElementById(`val-${id}-unid`);
        const clpEl = document.getElementById(`val-${id}-clp`);

        const prodCount = (estados[key]?.productos || 0);
        const stock0Count = (estados[key]?.stock0 || 0);

        if (prodEl) {
            prodEl.textContent = prodCount.toLocaleString('es-CL');
        }
        if (unidEl) unidEl.textContent = (estados[key]?.unidades || 0).toLocaleString('es-CL');

        if (clpEl) {
            if (key === "REORDEN") {
                clpEl.textContent = (estados[key]?.valor > 0) ? fmtExact(estados[key].valor) : "Falta pedido";
                clpEl.style.fontSize = (estados[key]?.valor > 0) ? "" : "0.7rem";
            } else if (key === "REPUESTO") {
                clpEl.textContent = fmtExact(estados[key]?.valor || 0);
                clpEl.style.fontSize = "";
            } else {
                clpEl.textContent = fmtExact(estados[key]?.valor || 0);
                clpEl.style.fontSize = "";
            }
        }

        // Añadir botón de acción rápida al header de la tarjeta (si no existe)
        const header = card.querySelector('.risk-header');
        if (header && !header.querySelector('.btn-risk-ia')) {
            const btn = document.createElement('button');
            btn.className = 'btn-risk-ia';
            btn.innerHTML = '⚡ Ver Estrategia';
            btn.title = "Ver plan de acción y recomendaciones del asistente para este estado";
            btn.onclick = (e) => {
                e.stopPropagation();
                document.querySelector('.ia-card')?.scrollIntoView({ behavior: 'smooth' });
                highlightIARecommendation(key);
            };
            header.appendChild(btn);
        }

        // Ocultar tarjetas de riesgo del top si verdaderamente no hay productos activos (ni pendientes, ni vivos).
        if (id !== 'normal') {
            const prodNum = (estados[key]?.productos || 0);
            if (prodNum === 0) card.style.display = 'none';
            else card.style.display = 'block';
        }
    });

    // HU-CONTINUIDAD: Actualizar la sección informativa de quiebres
    const sectionCont = document.getElementById('section-continuidad-stock');
    if (sectionCont && window.INFO_CONTINUIDAD) {
        if (window.INFO_CONTINUIDAD.total > 0) {
            sectionCont.style.display = 'block';
            const badge = document.getElementById('badge-stockout-total');
            const items = document.getElementById('val-info-reorden');
            const clp = document.getElementById('val-info-reorden-clp');

            if (badge) badge.textContent = `${window.INFO_CONTINUIDAD.total} Quiebres Detectados`;
            if (items) items.textContent = `${window.INFO_CONTINUIDAD.unmanaged} ítems`;
            if (clp) clp.textContent = fmtExact(window.INFO_CONTINUIDAD.investment);
        } else {
            sectionCont.style.display = 'none';
        }
    }

    // Totales generales para barra de resumen en estados de crisis y barra global
    // HU: Si hay selección, usar solo los estados seleccionados. Si no, los 4 de riesgo. (Power BI Style)
    const estadosRiesgoBase = ["VENCIDO", "CRÍTICO", "URGENTE", "PREVENTIVO"];
    const selects = Array.from(window.SELECCION_ESTADOS_RIESGO || []);
    const hasSeleccion = selects.length > 0;

    const kRiesgo = hasSeleccion ? selects.filter(k => estadosRiesgoBase.includes(k)) : estadosRiesgoBase;
    const kNormal = hasSeleccion ? selects.filter(k => k === "NORMAL") : [];

    const valRiesgo = kRiesgo.reduce((s, k) => s + (estados[k]?.valor || 0), 0);
    const valNormal = kNormal.reduce((s, k) => s + (estados[k]?.valor || 0), 0);
    const countRiesgo = kRiesgo.reduce((s, k) => s + (estados[k]?.productos || 0), 0);
    const countNormal = kNormal.reduce((s, k) => s + (estados[k]?.productos || 0), 0);
    const unidRiesgo = kRiesgo.reduce((s, k) => s + (estados[k]?.unidades || 0), 0);
    const unidNormal = kNormal.reduce((s, k) => s + (estados[k]?.unidades || 0), 0);

    // Actualizar barra global (Coherencia superior)
    const gRisk = document.getElementById("totalRiskGlobal");
    const gCrit = document.getElementById("criticalCountGlobal");
    if (gRisk) {
        gRisk.textContent = formatCLP(valRiesgo);
        const label = gRisk.previousElementSibling;
        if (label && isStockout) label.textContent = "Capital Comprometido";
        else if (label) label.textContent = "Valor en Riesgo";
    }
    if (gCrit) {
        const vProd = estados["VENCIDO"]?.productos || 0;
        const cProd = estados["CRÍTICO"]?.productos || 0;
        const totalActivos = vProd + cProd;
        const totalS0 = estados["REORDEN"]?.stock0 || 0;

        const label = gCrit.previousElementSibling;
        if (label && isStockout) label.textContent = "Quiebres Inm.";
        else if (label) label.textContent = "Casos Críticos";

        if (totalS0 > 0) {
            gCrit.innerHTML = `<span style="display:flex; align-items:center; gap:8px;">
                                 <span>${totalActivos.toLocaleString('es-CL')} activos</span>
                               </span>`;
        } else {
            gCrit.textContent = totalActivos.toLocaleString('es-CL');
        }
    }

    // MOSTRAR INDICADOR DE FECHA SI ESTÁ EN MODO PROYECCIÓN
    if (window._FILTRO_MES && window._FILTRO_ANIO) {
        const header = document.querySelector('.header .left h1');
        if (header && !document.getElementById('mode-projection-badge')) {
            const badge = document.createElement('span');
            badge.id = 'mode-projection-badge';
            badge.style = "font-size: 0.65rem; background: #8b5cf6; color: white; padding: 2px 8px; border-radius: 4px; margin-left: 10px; vertical-align: middle; text-transform: uppercase;";
            badge.innerText = `Simulación: ${window._FILTRO_MES}/${window._FILTRO_ANIO}`;
            header.appendChild(badge);
        } else if (document.getElementById('mode-projection-badge')) {
            document.getElementById('mode-projection-badge').innerText = `Simulación: ${window._FILTRO_MES}/${window._FILTRO_ANIO}`;
        }
    }

    // HU-REORDEN: Actualizar panel inferior dedicado
    const reordenPanel = document.getElementById("reorden-panel-bottom");
    const reordenCountEl = document.getElementById("val-reorden-prod-bottom");
    if (reordenPanel && reordenCountEl) {
        const s0 = (estados["REORDEN"]?.stock0 || 0);
        reordenCountEl.textContent = s0;
        reordenPanel.style.display = (s0 > 0) ? 'flex' : 'none';
    }

    // Si la estrategia está aplicada, mostrar el impacto en el ahorro/recuperación
    const totalEl = document.getElementById("totalValorRiesgo");
    if (totalEl) {
        // HU-COHERENCIA: Distinguir 'Riesgo' de 'Normal' explícitamente
        const badgeFiltro = hasSeleccion ? `<span style="font-size:0.6rem; color:#6366f1; background:#eeefff; padding:2px 6px; border-radius:4px; margin-right:8px; display:inline-block;">FILTRO ACTIVO (${selects.length})</span>` : "";

        let html = `<div style="display:flex; flex-direction:column; align-items:flex-end;">`;

        // Bloque de Riesgo
        if (kRiesgo.length > 0) {
            if (window.IA_PLAN_ACCION_GLOBAL_APLICADO && window.SENSIBILIDAD_ACTUAL) {
                const rec = (window.SENSIBILIDAD_ACTUAL.escenario_preventivo?.recuperacion_estimada || 0) + (window.SENSIBILIDAD_ACTUAL.escenario_urgente?.recuperacion_estimada || 0);
                const riesgoNeto = Math.max(0, valRiesgo - rec);
                html += `
                    <div style="display:flex; align-items:center;">${badgeFiltro}<span style="font-size:0.8rem; text-decoration:line-through; opacity:0.6;">${fmtExact(valRiesgo)}</span></div>
                    <span style="color:#ef4444; font-weight:800; font-size:1.1rem;">${fmtExact(riesgoNeto)}</span>
                    <span style="font-size:0.65rem; background:#10b98122; color:#059669; padding:2px 6px; border-radius:4px; margin-top:2px;">RIESGO NETO (ESTRATEGIA RECOMENDADA)</span>
                `;
            } else {
                html += `<div style="display:flex; align-items:center;">${badgeFiltro}<span style="color:#ef4444; font-weight:800; font-size:1.1rem;">${fmtExact(valRiesgo)}</span></div>
                         <span style="font-size:0.65rem; color:#94a3b8; font-weight:600; text-transform:uppercase;">Valor Total en Riesgo</span>`;
            }
        }

        // Bloque Normal (Distinción aparte)
        if (kNormal.length > 0) {
            html += `<div style="height:1px; width:100%; max-width:100px; background:#e2e8f0; margin:8px 0;"></div>
                     <span style="color:#10b981; font-weight:800; font-size:0.95rem;">${fmtExact(valNormal)}</span>
                     <span style="font-size:0.65rem; color:#10b981; font-weight:600; text-transform:uppercase;">Stock Operativo Seleccionado</span>`;
        }

        // --- GRAN SUMA (HU: "dame la suma") ---
        if (kRiesgo.length > 0 && kNormal.length > 0) {
            const granTotal = valRiesgo + valNormal;
            html += `
                <div style="height:2px; width:100%; max-width:140px; background:#6366f1; margin:12px 0 6px 0; opacity:0.8;"></div>
                <div style="display:flex; align-items:baseline; gap:6px;">
                    <span style="font-size:0.75rem; color:#6366f1; font-weight:700; text-transform:uppercase; letter-spacing:0.02em;">Total Seleccionado:</span>
                    <span style="color:#ffffff; font-weight:900; font-size:1.3rem; text-shadow:0 0 10px rgba(99,102,241,0.3);">${fmtExact(granTotal)}</span>
                </div>
            `;
        }

        html += `</div>`;
        totalEl.innerHTML = html;
    }

    const itemsEl = document.getElementById("totalItemsRiesgo");
    if (itemsEl) itemsEl.textContent = (countRiesgo + countNormal).toLocaleString('es-CL');

    const unitsEl = document.getElementById("totalUnidadesRiesgo");
    if (unitsEl) unitsEl.textContent = (unidRiesgo + unidNormal).toLocaleString('es-CL');

    // Mostrar u ocultar aclaración de NORMAL según selección
    const isNormalDisplayed = (kNormal.length > 0);
    const excluyeSpan = document.getElementById("label-riesgo-excluye");
    const excluyeSep = document.getElementById("separador-riesgo-excluye");
    const labelItems = document.getElementById("label-riesgo-items");
    const labelUnidades = document.getElementById("label-riesgo-unidades");

    if (excluyeSpan && labelItems && labelUnidades) {
        if (isNormalDisplayed) {
            // "Normal" fue seleccionado explicitamente, ocultar aclaración de exclusión
            excluyeSpan.style.display = "none";
            if (excluyeSep) excluyeSep.style.display = "none";
            labelItems.textContent = "Ítems seleccionados:";
            labelUnidades.textContent = "Unidades seleccionadas:";
        } else {
            // Riesgo predeterminado (solo excluye normal)
            excluyeSpan.style.display = "inline";
            if (excluyeSep) excluyeSep.style.display = "block";
            labelItems.textContent = "Productos en riesgo:";
            labelUnidades.textContent = "Unidades afectadas:";
        }
    }
}

// Configuración de estados para el accordion
const ESTADO_CONFIG = {
    "REORDEN": { color: "#3b82f6", bg: "rgba(59,130,246,0.08)", dot: "#3b82f6", orden: -1, icono: "🛒" },
    "VENCIDO": { color: "#9333ea", bg: "rgba(147,51,234,0.08)", dot: "#9333ea", orden: 0 },
    "CRÍTICO": { color: "#ef4444", bg: "rgba(239,68,68,0.07)", dot: "#ef4444", orden: 1 },
    "URGENTE": { color: "#f97316", bg: "rgba(249,115,22,0.07)", dot: "#f97316", orden: 2 },
    "PREVENTIVO": { color: "#eab308", bg: "rgba(234,179,8,0.07)", dot: "#eab308", orden: 3 },
    "NORMAL": { color: "#22c55e", bg: "rgba(34,197,94,0.05)", dot: "#22c55e", orden: 4 },
};

const CRISIS_THRESHOLD = 20; // Umbral para activar Vista de Crisis (SKUs)
const VALOR_CRISIS_THRESHOLD = 5000000; // O si el valor supera 5M CLP

function computarPareto(items) {
    // Agrupar por nombre condensado
    const map = {};
    items.forEach(it => {
        const nom = (it.nombre_producto || 'Sin Nombre').trim().toUpperCase();
        if (!map[nom]) {
            map[nom] = { ...it, cantidad_stock: 0, valor_stock: 0, lotes_count: 0, min_fecha: it.fecha_vencimiento };
        }
        const stock = parseFloat(it.cantidad_stock || 0);
        const valor = parseFloat(it.valor_stock || 0);
        map[nom].cantidad_stock += stock;
        map[nom].valor_stock += valor;
        map[nom].lotes_count += 1;
        if (it.fecha_vencimiento && (!map[nom].min_fecha || new Date(it.fecha_vencimiento) < new Date(map[nom].min_fecha))) {
            map[nom].min_fecha = it.fecha_vencimiento;
        }
        if (it.dias_riesgo_total !== undefined && (map[nom].dias_riesgo_total === undefined || it.dias_riesgo_total < map[nom].dias_riesgo_total)) {
            map[nom].dias_riesgo_total = it.dias_riesgo_total;
        }
    });

    const sorted = Object.values(map).sort((a, b) => (b.valor_stock || 0) - (a.valor_stock || 0));
    const totalValor = sorted.reduce((s, i) => s + (i.valor_stock || 0), 0);
    let acum = 0;
    const pareto = [];
    for (const it of sorted) {
        acum += (it.valor_stock || 0);
        pareto.push({ ...it, pct_acum: acum / totalValor });
        if (acum >= totalValor * 0.8 || pareto.length >= 50) break;
    }
    return { pareto, totalValor, totalItems: items.length, totalAgrupados: sorted.length, pct80count: pareto.length };
}

function agruparPorCategoriaAccion(items) {
    const merma = [], donacion = [], reetiquetado = [];
    items.forEach(it => {
        const diasVenc = it.dias_riesgo_total ?? 0;
        const demanda = it.demanda_diaria || 0;
        const valor = it.valor_stock || 0;
        // Reglas heurísticas de clasificación de acción
        if (diasVenc <= -15) {
            merma.push(it); // Vencidos hace más de 15 días → merma inevitable
        } else if (demanda < 0.1 || valor < 50000) {
            reetiquetado.push(it); // Sin demanda o bajo valor → posible extensión
        } else {
            donacion.push(it); // Resto → candidatos a donación (ventana aún válida)
        }
    });
    return { merma, donacion, reetiquetado };
}

// Función para mostrar plan de reorden (Stock 0)
window.abrirPlanReorden = function () {
    const stock0 = (DATOS_CRUDOS || []).filter(it => parseFloat(it.cantidad_stock || 0) <= 0);
    if (!stock0.length) {
        Swal.fire("Inventario Completo", "No se detectan productos con stock en cero en las categorías analizadas.", "success");
        return;
    }

    const itemsHtml = stock0.slice(0, 15).map(it => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #e2e8f0;">
            <div style="text-align:left;">
                <p style="margin:0; font-weight:700; color:#1e293b; font-size:0.9rem;">${it.nombre_producto}</p>
                <p style="margin:0; font-size:0.75rem; color:#64748b;">${it.categoria || 'Sin Categoría'} | 🗓️ ${it.estado_alerta}</p>
            </div>
            <div style="text-align:right;">
                <span style="font-size:0.7rem; background:#eff6ff; color:#1d4ed8; padding:3px 8px; border-radius:100px; font-weight:800; border:1px solid #bfdbfe;">SUG. REORDEN</span>
            </div>
        </div>
    `).join('');

    Swal.fire({
        title: 'Plan de Reabastecimiento Crítico',
        html: `
            <div style="margin-top:1rem;">
                <p style="text-align:left; font-size:0.9rem; color:#475569; margin-bottom:1.5rem;">Se han identificado <strong>${stock0.length} SKUs</strong> con stock agotado. Se recomienda generar orden de compra inmediata para evitar pérdida de ventas.</p>
                <div style="max-height:350px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:12px; background:#f8fafc;">
                    ${itemsHtml}
                    ${stock0.length > 15 ? `<p style="padding:10px; font-size:0.75rem; color:#64748b; font-style:italic;">Mostrando los primeros 15 de ${stock0.length} productos...</p>` : ''}
                </div>
            </div>
        `,
        icon: 'info',
        showCancelButton: true,
        confirmButtonColor: '#3b82f6',
        cancelButtonText: 'Cerrar',
        confirmButtonText: '📦 Generar Orden de Compra (Draft)',
        width: '600px'
    }).then(async (result) => {
        if (result.isConfirmed) {
            // 1. Simular la entrada de Stock (Coherencia: pasan de REORDEN a su estado de alerta con stock)
            const stock0 = (DATOS_CRUDOS || []).filter(it => parseFloat(it.cantidad_stock || 0) <= 0);

            const totalVal = stock0.reduce((s, i) => s + (parseFloat(i.precio_costo || 0) * 100), 0);
            const totalQty = stock0.length * 100;

            // PERSISTENCIA: Agregarlos a la orden del día para que el usuario los vea en el drawer y descargue el CSV
            if (!window.ITEMS_ORDEN) window.ITEMS_ORDEN = new Map();
            stock0.forEach(it => {
                const escenarioText = 'Quiebre Crítico';
                const key = it.nombre_producto;
                let existingQty = 0;
                if (window.ITEMS_ORDEN.has(key)) {
                    existingQty = window.ITEMS_ORDEN.get(key).cantidad;
                }
                window.ITEMS_ORDEN.set(key, {
                    producto: it.nombre_producto,
                    cantidad: 100 + existingQty, // Cantidad sugerida base sumada a existente
                    escenario: escenarioText,
                    fecha: new Date().toLocaleDateString()
                });
            });
            window._guardarPersistenciaOrden();

            stock0.forEach(it => {
                it.cantidad_stock = 100; // Mock local para que desaparezcan de REORDEN
                it.valor_stock = parseFloat(it.precio_costo || 0) * 100;
            });

            // 2. Registrar en el historial maestro
            try {
                const payload = [{
                    id_producto: "REORDEN-MASIVO",
                    nombre_producto: `REABASTECIMIENTO CRÍTICO (${stock0.length} SKUs)`,
                    cantidad: totalQty,
                    valor: totalVal,
                    organizacion: "Pedido a Proveedor (Automatizado)",
                    detalles_agregados: `Reabastecimiento automático para mitigar quiebre de stock. Se agregaron a la Orden del Día.`,
                    fuente: window._analisisActivo || "Planificador"
                }];

                await fetch(`${API_URL}/api/donations/bulk`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${localStorage.getItem("token")}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });
            } catch (err) {
                console.warn("Sincronización de base de datos omitida.");
            }

            // 3. Actualizar UI
            window.actualizarInterfazLocal();
            if (window.actualizarListaOrden) window.actualizarListaOrden();
            if (window.actualizarContadorOrdenHeader) window.actualizarContadorOrdenHeader();

            Swal.fire({
                title: 'Orden Generada',
                html: `Se han derivado <strong>${stock0.length} SKUs</strong> a tu Orden del Día.<br>Revisa el panel lateral para descargar el CSV de compra.`,
                icon: 'success',
                confirmButtonText: 'Ver Mi Orden',
                confirmButtonColor: '#3b82f6'
            }).then(() => {
                // Abrir el drawer automáticamente para dar feedback visual
                if (typeof window.toggleResumenOrden === 'function') {
                    const drawer = document.getElementById("orderDrawer");
                    if (drawer && !drawer.classList.contains('active')) {
                        window.toggleResumenOrden();
                    }
                }
            });
        }
    });
};

window.orderIndividual = function (id) {
    const prod = (DATOS_CRUDOS || []).find(it => String(it.id_producto || it.nombre_producto) === String(id));
    if (!prod) return;

    Swal.fire({
        title: `Reorden: ${prod.nombre_producto}`,
        html: `
            <div style="text-align:left; font-size:0.9rem;">
                <p><strong>Categoría:</strong> ${prod.categoria || '—'}</p>
                <p><strong>Estado:</strong> ${prod.estado_alerta}</p>
                <hr style="border:0; border-top:1px solid #e2e8f0; margin:10px 0;">
                <label style="font-weight:700;">Cantidad a Pedir:</label>
                <input type="number" value="100" class="swal2-input" style="width:100%; margin:10px 0; background: #f8fafc; border: 1px solid #cbd5e1;">
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: '🛒 Crear Orden',
        confirmButtonColor: '#3b82f6',
        cancelButtonText: 'Cancelar'
    }).then(async res => {
        if (res.isConfirmed) {
            const input = Swal.getHtmlContainer().querySelector('input');
            const qty = parseInt(input.value) || 0;

            if (qty > 0) {
                // 1. Modificar localmente
                prod.cantidad_stock = qty;
                prod.valor_stock = parseFloat(prod.precio_costo || 0) * qty;

                // 2. Mock Registry
                const payload = [{
                    id_producto: prod.id_producto || "INDIV",
                    nombre_producto: `REABASTECIMIENTO INDIVIDUAL: ${prod.nombre_producto}`,
                    cantidad: qty,
                    valor: prod.valor_stock,
                    organizacion: "Pedido a Proveedor",
                    detalles_agregados: `Reposición de stock para SKU agotado.`,
                    fuente: window._analisisActivo || "Manual"
                }];

                try {
                    await fetch(`${API_URL}/api/donations/bulk`, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${localStorage.getItem("token")}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(payload)
                    });
                } catch (e) { }

                // 3. UI Sync
                window.actualizarInterfazLocal();

                Swal.fire({
                    title: 'Stock Actualizado',
                    text: `Se han añadido ${qty} unidades a ${prod.nombre_producto}.`,
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });
            }
        }
    });
};

function renderizarTreemapVencidos(items, container, estado) {
    // Agrupar por categoría
    const byCat = {};
    items.forEach(it => {
        const cat = it.categoria || "Sin Categoría";
        if (!byCat[cat]) byCat[cat] = { valor: 0, count: 0 };
        byCat[cat].valor += (it.valor_stock || 0);
        byCat[cat].count++;
    });
    const cats = Object.entries(byCat).sort(([, a], [, b]) => b.valor - a.valor).slice(0, 12);
    const maxVal = Math.max(...cats.map(([, v]) => v.valor));
    const PALETA = ["#9333ea", "#c026d3", "#db2777", "#ef4444", "#f97316", "#eab308", "#7c3aed", "#be185d", "#991b1b", "#92400e", "#1d4ed8", "#065f46"];

    const treemapHtml = cats.map(([cat, dat], idx) => {
        const pct = dat.valor / maxVal;
        const h = Math.max(40, Math.round(pct * 110));
        const color = PALETA[idx % PALETA.length];
        const alpha = 0.15 + pct * 0.45;
        return `
            <div title="${cat}: ${dat.count} prod, $${dat.valor.toLocaleString('es-CL')}"
                style="flex:${Math.max(1, Math.round(pct * 12))}; min-width:80px; height:${Math.max(60, Math.round(pct * 150))}px;
                       background:${color}; opacity:${alpha + 0.55};
                       border-radius:8px; display:flex; flex-direction:column;
                       align-items:center; justify-content:center; padding:4px;
                       cursor:pointer; transition:all 0.2s; position:relative;
                       border:2px solid ${color}; overflow:hidden; box-shadow:0 4px 6px rgba(0,0,0,0.1);"
                onclick="window.aplicarFiltroCategoriaCrisis('${cat.replace(/'/g, "\\'")}', '${estado}')"
                onmouseover="this.style.opacity=1; this.style.zIndex=2; this.style.transform='scale(1.04)';"
                onmouseout="this.style.opacity='${alpha + 0.55}'; this.style.zIndex=1; this.style.transform='scale(1)';">
                <span style="font-size:0.65rem; font-weight:800; color:white; text-align:center; text-shadow:0 1px 3px rgba(0,0,0,0.6); line-height:1.2; word-break:break-word; max-width:98%;">${cat}</span>
                <span style="font-size:0.58rem; color:rgba(255,255,255,0.9); font-weight:600; margin-top:2px;">${dat.count} prod</span>
                ${(pct > 0.05 || h > 55) ? `<span style="font-size:0.75rem; color:#fff; font-weight:900; background:rgba(0,0,0,0.2); padding:2px 6px; border-radius:4px; margin-top:4px;">$${dat.valor.toLocaleString('es-CL')}</span>` : ''}
            </div>`;
    }).join('');

    return `
        <div style="margin:1rem 0;">
            <p style="font-size:0.78rem; color:#6b7280; margin-bottom:0.5rem; font-weight:600;">DISTRIBUCIÓN POR CATEGORÍA (área = valor perdido) <span style="font-weight:400; font-size:0.7rem;">| Haz clic en un bloque para ver productos</span></p>
            <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:flex-end; min-height:160px; padding:10px; background:#fdf4ff; border-radius:10px; border:1px solid #e9d5ff;">
                ${treemapHtml}
            </div>
        </div>`;
}

window.abrirDetalleCategoria = function (cat, estado) {
    // Normalizar estado
    const norm = (s) => (s || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const std = norm(estado);

    // Filtrar globales
    const items = window.DATOS_CRUDOS.filter(i => {
        const catMatch = (cat === 'TODOS_EN_ESTADO' || (i.categoria || "Sin Categoría") === cat);
        const eMatch = norm(i.estado_alerta) === std;
        return catMatch && eMatch;
    }).sort((a, b) => (b.valor_stock || 0) - (a.valor_stock || 0));

    if (items.length === 0) return;

    let totalVal = 0;
    const rows = items.map(it => {
        totalVal += (it.valor_stock || 0);
        return `
            <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:8px; font-size:0.75rem; text-align:left;">${(it.nombre_producto || 'Desconocido').substring(0, 40)}</td>
                <td style="padding:8px; font-size:0.75rem; text-align:right;">${(it.cantidad_stock || 0).toLocaleString('es-CL')}</td>
                <td style="padding:8px; font-size:0.75rem; text-align:right; font-weight:700; color:#0f172a;">$${(it.valor_stock || 0).toLocaleString('es-CL')}</td>
                <td style="padding:8px; font-size:0.75rem; color:#64748b; text-align:center;">${it.fecha_vencimiento ? new Date(it.fecha_vencimiento + "T12:00:00").toLocaleDateString('es-CL') : 'N/A'}</td>
                <td style="padding:8px; text-align:center;">
                    <button data-id="${String(it.id_producto).replace(/"/g, '&quot;')}" 
                        onclick="window.tratarProductoDesdeUI(this)" 
                        style="background:#10b98115; color:#059669; border:1px solid #10b981; border-radius:4px; padding:2px 8px; font-size:0.65rem; font-weight:800; cursor:pointer; transition:all 0.2s;">
                        Tratar Indiv.
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    const tableHtml = `
        <div style="text-align:left; font-family:'Inter', sans-serif;">
            <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:1rem;">
                <div>
                    <h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#1e293b;">${cat}</h3>
                    <p style="margin:0; font-size:0.8rem; color:#64748b;">${items.length} Lotes | ${estado}</p>
                </div>
                <div style="text-align:right;">
                    <span style="font-size:1.2rem; font-weight:800; color:#9333ea;">$${totalVal.toLocaleString('es-CL')}</span>
                </div>
            </div>
            <div style="max-height:400px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px;">
                <table style="width:100%; border-collapse:collapse;">
                    <thead style="background:#f8fafc; position:sticky; top:0;">
                        <tr>
                            <th style="padding:8px; font-size:0.75rem; color:#64748b; text-align:left;">Producto</th>
                            <th style="padding:8px; font-size:0.75rem; color:#64748b; text-align:right;">Unidades</th>
                            <th style="padding:8px; font-size:0.75rem; color:#64748b; text-align:right;">Capital CLP</th>
                            <th style="padding:8px; font-size:0.75rem; color:#64748b; text-align:center;">Vence</th>
                            <th style="padding:8px; font-size:0.75rem; color:#64748b; text-align:center;">Gestión</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;

    Swal.fire({
        html: tableHtml,
        width: 600,
        showConfirmButton: false,
        showCloseButton: true,
        customClass: {
            container: 'swal-wide-container'
        }
    });
};

// Helper para filtrar Vista de Crisis desde el treemap
window.agruparPorEstado = function (data) {
    const grupos = { "VENCIDO": [], "CRÍTICO": [], "URGENTE": [], "PREVENTIVO": [], "NORMAL": [] };
    const normalize = (s) => (s || "NORMAL").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const STATE_MAP = { "REORDEN": "CRÍTICO", "REPUESTO": "CRÍTICO", "VENCIDO": "VENCIDO", "CRITICO": "CRÍTICO", "URGENTE": "URGENTE", "PREVENTIVO": "PREVENTIVO", "NORMAL": "NORMAL" };

    (data || []).forEach(it => {
        const est = STATE_MAP[normalize(it.estado_alerta)] || "NORMAL";
        if (grupos[est]) grupos[est].push(it);
    });
    return grupos;
};

window.aplicarFiltroCategoriaCrisis = function (cat, estado) {
    console.debug(`Filtrando ${estado} por categoría: ${cat}`);
    window._filtroCategoriaCrisis[estado] = cat;

    // Forzar re-renderizado solo del contenedor de este estado
    const acordeonId = `grupo-${estado.replace(/[^a-z]/gi, '')}`;
    const container = document.getElementById(acordeonId);
    if (container) {
        // Obtenemos los items originales para ese estado desde el global
        const grupos = agruparPorEstado(window.DATOS_CRUDOS);
        const itemsOriginales = grupos[estado] || [];
        container.innerHTML = "";
        renderizarVistaCrisis(itemsOriginales, container, estado);
    }
};

window.limpiarFiltroCategoriaCrisis = function (estado) {
    delete window._filtroCategoriaCrisis[estado];
    const acordeonId = `grupo-${estado.replace(/[^a-z]/gi, '')}`;
    const container = document.getElementById(acordeonId);
    if (container) {
        const grupos = agruparPorEstado(window.DATOS_CRUDOS);
        const itemsOriginales = grupos[estado] || [];
        container.innerHTML = "";
        renderizarVistaCrisis(itemsOriginales, container, estado);
    }
};

window.descargarInventarioCrudoPorEstado = function (estado) {
    let datos = [];
    let baseItems = (typeof DATOS_CRUDOS !== 'undefined') ? DATOS_CRUDOS : [];

    // HU-COHERENCIA: Excluir productos con stock virtual 0 o negativo 
    // para que el CSV coincida exactamente con las unidades mostradas en UI.
    baseItems = baseItems.filter(i => parseFloat(i.cantidad_stock || 0) > 0);

    if (estado && estado !== 'TODOS') {
        const filtroCat = window._filtroCategoriaCrisis && window._filtroCategoriaCrisis[estado];

        datos = baseItems.filter(i => {
            const estadoMap = {
                'vencido': 'VENCIDO',
                'vencidos': 'VENCIDO',
                'vencimiento': 'VENCIDO',
                'crítico': 'CRÍTICO',
                'critico': 'CRÍTICO',
                'alerta': 'ALERTA',
                'normal': 'NORMAL',
                'urgente': 'URGENTE',
                'optimo': 'NORMAL',
                'óptimo': 'NORMAL'
            };
            const normalize = (val) => val ? String(val).toLowerCase().trim() : '';
            const isMatch = estadoMap[normalize(i.estado_alerta)] === estado;
            if (!isMatch) return false;

            if (filtroCat) {
                return i.categoria === filtroCat;
            }
            return true;
        });
    } else {
        datos = baseItems;
    }

    if (!datos || datos.length === 0) {
        if (typeof showToast === "function") showToast("No hay datos para descargar.", "error");
        return;
    }

    // Obtener todas las columnas dinámicamente de los datos para no perder nada
    const colSet = new Set();
    datos.forEach(row => {
        Object.keys(row).forEach(k => colSet.add(k));
    });
    const columnas = Array.from(colSet);

    let csvContent = "\ufeff" + columnas.join(";") + "\n";

    datos.forEach(row => {
        const valores = columnas.map(col => {
            let val = row[col];
            if (val === null || val === undefined) val = "";
            val = String(val).replace(/"/g, '""'); // Escapar comillas dobles
            // Envolver en comillas si tiene el delimitador, nuevas líneas o comillas
            if (val.includes(";") || val.includes("\n") || val.includes("\r") || val.includes('"')) {
                val = `"${val}"`;
            }
            return val;
        });
        csvContent += valores.join(";") + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Inventario_Crudo_SmartStock_${estado ? estado : 'Completo'}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    if (typeof showToast === "function") showToast("Descarga de CSV iniciada.", "success");
};

// Mantenemos la original por compatibilidad general
window.descargarInventarioCrudo = function () {
    window.descargarInventarioCrudoPorEstado('TODOS');
};

function renderizarVistaCrisis(itemsOriginales, container, estado) {
    // Aplicar filtro si existe
    const filtroCat = window._filtroCategoriaCrisis[estado];
    const items = filtroCat ? itemsOriginales.filter(it => it.categoria === filtroCat) : itemsOriginales;

    // HU-COHERENCIA: Solo operar sobre items con stock real para métricas y Pareto
    const itemsActivos = items.filter(it => parseFloat(it.cantidad_stock || 0) > 0);
    const itemsSinStock = items.filter(it => parseFloat(it.cantidad_stock || 0) <= 0);
    const countS0 = itemsSinStock.length;
    const { pareto, totalValor, totalItems, totalAgrupados, pct80count } = computarPareto(itemsActivos);

    const valTotalItemsOriginales = itemsOriginales.reduce((s, i) => s + (i.valor_stock || 0), 0);
    const { cat1, cat2, cat3 } = agruparPorCategoriasDinamicas(itemsActivos, estado);
    const cfg = ESTADO_CONFIG[estado] || { color: "#9333ea", bg: "#fdf4ff", dot: "#9333ea" };
    const fmtM = (v) => `$${Math.round(v || 0).toLocaleString('es-CL')}`;

    function getRangoFechaEstado(st) {
        const hoyDate = window.HOY ? new Date(window.HOY) : new Date();
        const fmt = (d) => d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
        const d1 = new Date(hoyDate);
        const d2 = new Date(hoyDate);

        const norm = (s) => (s || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const s = norm(st);

        const formatHighlightedDate = (d) => {
            const day = d.getDate().toString().padStart(2, '0');
            const month = d.toLocaleDateString('es-CL', { month: 'short' }).toUpperCase();
            return `<span style="color:#fde047; font-weight:900;">${day} ${month}</span>`;
        };

        if (s === "VENCIDO") return `Expirados al ${formatHighlightedDate(d1)}`;
        if (s === "CRITICO") { d1.setDate(d1.getDate() + 1); d2.setDate(d2.getDate() + 3); }
        else if (s === "URGENTE") { d1.setDate(d1.getDate() + 4); d2.setDate(d2.getDate() + 7); }
        else if (s === "PREVENTIVO") { d1.setDate(d1.getDate() + 8); d2.setDate(d2.getDate() + 10); }
        else { d1.setDate(d1.getDate() + 11); return `Vence desde ${formatHighlightedDate(d1)}`; }
        return `${formatHighlightedDate(d1)} al ${formatHighlightedDate(d2)}`;
    }

    const val1 = cat1.items.reduce((s, i) => s + (i.valor_stock || 0), 0);
    const val2 = cat2.items.reduce((s, i) => s + (i.valor_stock || 0), 0);
    const val3 = cat3.items.reduce((s, i) => s + (i.valor_stock || 0), 0);

    let r1 = 0, r2 = 0, r3 = 0;
    if (estado === "VENCIDO") {
        r1 = 0.27; // Beneficio tributario Merma
        r2 = 0.35; // Recupero IVA/Costo Donación
        r3 = 1.0;  // Re-etiquetado
    } else if (estado === "CRÍTICO") {
        r1 = 0.30; // Flash (70% desc -> 30% recup)
        r2 = 0.35; // Donación Social
        r3 = 0.50; // Pack costo = 50% recup
    } else if (estado === "URGENTE") {
        r1 = 0.70; // Combo -> 70% recup
        r2 = 0.35; // Donación => 35%
        r3 = 0.60; // Descuento 40% => 60% recup
    } else if (estado === "PREVENTIVO") {
        r1 = 0.85; // Oferta Flash => 85% recup
        r2 = 0.50; // Salud => 50%
        r3 = 1.0;  // Monitoreo => 100%
    } else {
        r1 = 1.0; r2 = 1.0; r3 = 1.0;
    }

    const recuperoCalculado = (val1 * r1) + (val2 * r2) + (val3 * r3);
    const tasaRecupero = totalValor > 0 ? (recuperoCalculado / totalValor) : 0;

    // Generar el texto descriptivo coherente
    let breakdownText = "";
    if (totalValor > 0) {
        breakdownText = `El modelo proyecta rescatar <b>${Math.round(tasaRecupero * 100)}%</b> del capital aplicando:<br>
        <span style="display:inline-block; margin-top:4px; font-size:0.75rem; color:#64748b; font-weight:600; background:#f1f5f9; padding:2px 8px; border-radius:4px; border:1px solid #e2e8f0;">${cat1.label} (${Math.round(r1 * 100)}%)</span> 
        <span style="display:inline-block; margin-top:4px; font-size:0.75rem; color:#64748b; font-weight:600; background:#f1f5f9; padding:2px 8px; border-radius:4px; border:1px solid #e2e8f0;">${cat2.label} (${Math.round(r2 * 100)}%)</span>`;
    }

    const treemapHtml = renderizarTreemapVencidos(itemsActivos, container, estado);

    const sumTopPareto = pareto.reduce((s, i) => s + (i.valor_stock || 0), 0);
    const sumTopPct = totalValor > 0 ? Math.round((sumTopPareto / totalValor) * 100) : 0;

    const rows = pareto.map((it, idx) => {
        const pctAcum = Math.round(it.pct_acum * 100);
        const pctItem = Math.round((it.valor_stock / totalValor) * 100);
        const barWidth = Math.round(pctItem * 3.5);
        return `
            <tr style="border-bottom:1px solid ${cfg.color}10;">
                <td style="padding:6px 8px; font-size:0.75rem; font-weight:700; color:#6b7280;">#${idx + 1}</td>
                <td style="padding:6px 8px; font-size:0.78rem; font-weight:600; color:#1e293b; max-width:250px;">
                    ${(it.nombre_producto || 'Sin Nombre').substring(0, 30)}
                    <br><span style="font-size:0.65rem; color:#64748b; font-weight:500; display:inline-flex; align-items:center; gap:3px;">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.75;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg> 
                        ${it.lotes_count} lotes ${it.min_fecha ? `| <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.75; margin-left:3px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> Vence: ${new Date(it.min_fecha + "T12:00:00").toLocaleDateString('es-CL')}` : ''}
                    </span>
                </td>
                <td style="padding:6px 8px; font-size:0.75rem; color:#6b7280;">${it.categoria || '—'}</td>
                <td style="padding:6px 8px; font-size:0.75rem; text-align:center;">
                    ${it.dias_riesgo_total <= 0
                ? `<span style="background:#ef4444; color:white; padding:2px 6px; border-radius:4px; font-weight:800;">${Math.round(it.dias_riesgo_total)} d</span>`
                : it.dias_riesgo_total <= 7
                    ? `<span style="background:#f97316; color:white; padding:2px 6px; border-radius:4px; font-weight:800;">${Math.round(it.dias_riesgo_total)} d</span>`
                    : `<span style="color:#475569; font-weight:700;">${Math.round(it.dias_riesgo_total)} d</span>`
            }
                </td>
                <td style="padding:6px 8px; font-size:0.75rem; text-align:right; color:#6b7280;">${(it.cantidad_stock || 0).toLocaleString('es-CL')}</td>
                <td style="padding:6px 8px; text-align:right; font-size:0.9rem; font-weight:800; color:${cfg.color};">${fmtM(it.valor_stock)}</td>
                 <td style="padding:6px 8px;">
                     <div style="display:flex; align-items:center; gap:8px;">
                         <span style="font-size:0.75rem; color:#64748b; font-weight:600;">Top ${idx + 1}</span>
                     </div>
                 </td>
            </tr>`;
    }).join('');

    const html = `
        <div id="crisis-view-${estado}" style="margin-bottom:0.75rem; border-radius:16px; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,0.1); border:1px solid ${cfg.color}40;">
            <div style="background:linear-gradient(135deg, ${cfg.color}, ${cfg.color}bb); padding:1.2rem 1.5rem; display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:1rem;">
                    <div>
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <p style="margin:0; font-size:0.7rem; color:rgba(255,255,255,0.8); font-weight:700; text-transform:uppercase; letter-spacing:0.1em;">Gestión de Crisis: ${estado}</p>
                            <span style="background:rgba(255,255,255,0.2); color:white; padding:2px 8px; border-radius:100px; font-size:0.65rem; font-weight:800; border:1px solid rgba(255,255,255,0.3);">
                                ${getRangoFechaEstado(estado)}
                            </span>
                        </div>
                        <h3 style="margin:0; color:white; font-size:1.3rem; font-weight:800;">
                            ${totalItems.toLocaleString('es-CL')} activos 
                            ${countS0 > 0 ? `<span style="font-size:0.9rem; opacity:0.8; font-weight:400;">(+${countS0} sin stock)</span>` : ''}
                            ${filtroCat ? `en ${filtroCat}` : `en estado ${estado.toLowerCase()}`}
                        </h3>
                        <p style="margin:0.2rem 0 0 0; font-size:0.85rem; color:rgba(255,255,255,0.95);">
                            ${filtroCat ? `<span onclick="window.limpiarFiltroCategoriaCrisis('${estado}')" style="background:rgba(0,0,0,0.2); cursor:pointer; padding:2px 8px; border-radius:4px; font-weight:900; margin-right:8px;">❌ Quitar Filtro</span>` : ''}
                            Atención: <strong style="color:#fde68a;">${pct80count} SKUs</strong> concentran el <strong style="color:#fde68a;">80% de este riesgo</strong> financiero.
                        </p>
                    </div>
                </div>
                <div style="text-align:right; display:flex; gap:1rem; align-items:center;">
                    <div style="text-align:right;">
                        <p style="margin:0; font-size:0.7rem; color:rgba(255,255,255,0.8);">CAPITAL EN RIESGO</p>
                        <p id="capital-riesgo-${estado}" data-value="${totalValor}" style="margin:0; font-size:1.5rem; font-weight:900; color:white; transition: color 0.4s ease;">${fmtM(totalValor)}</p>
                    </div>
                </div>
            </div>

            <div style="background:white; padding:1.5rem;">
                ${estado === 'NORMAL' ? `
                <div style="background:#f0fdfa; border:1px solid #ccfbf1; border-radius:12px; padding:1.5rem 2rem; margin-bottom:2rem; display:flex; align-items:flex-start; gap:1.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                    <div style="font-size:1.5rem; line-height:1; color:#0f766e;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></div>
                    <div>
                        <h4 style="margin:0 0 0.5rem 0; font-size:1.25rem; color:#0f766e; font-weight:800; letter-spacing:-0.5px;">Estado Operativo Saludable</h4>
                        <p style="margin:0; font-size:0.9rem; color:#0f766e; opacity:0.85; line-height:1.5; font-weight:500;">Todo el inventario de esta categoría se encuentra dentro de los márgenes normales y sin riesgo inminente de caducidad. No se requieren acciones tácticas de salvataje. Se recomienda mantener las políticas automáticas de rotación y reposición.</p>
                    </div>
                </div>
                ` : `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                    <p style="font-size:0.8rem; font-weight:800; color:#64748b; text-transform:uppercase; margin:0;">Acciones Tácticas Masivas Recomendadas</p>
                </div>
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; margin-bottom:2rem;">
                    ${[cat1, cat2, cat3].map((c, idx) => {
        return `
                    <div style="background:${c.color}08; border:1px solid ${c.color}30; border-radius:16px; padding:1.2rem; border-left:5px solid ${c.color}; position:relative; transition:all 0.3s; box-shadow:none;">
                        <div style="display:flex; align-items:center; gap:0.6rem; margin-bottom:0.75rem;">
                            
                            <span style="font-weight:800; font-size:0.9rem; color:${c.label.toLowerCase().includes('merma') ? '#ef4444' : c.color};">${c.label}</span>
                            <span style="margin-left:auto; font-size:0.65rem; background:#ffffffaa; padding:2px 6px; border-radius:4px; font-weight:700; color:${c.color}; border:1px solid ${c.color}20;">
                                Expirados al ${getRangoFechaEstado(estado).split(' al ')[1] || getRangoFechaEstado(estado)}
                            </span>
                        </div>
                        <p style="font-size:1.6rem; font-weight:900; color:${c.color}; margin:0.3rem 0; letter-spacing:-0.5px;">${c.items.length.toLocaleString('es-CL')} <small style="font-size:0.6rem; opacity:0.7; font-weight:700;">SKUs</small></p>
                        <p style="font-size:0.85rem; font-weight:800; color:${c.color}; opacity:0.85; margin-bottom:0.75rem;">${fmtM(c.items.reduce((s, i) => s + (i.valor_stock || 0), 0))}</p>
                        <p style="font-size:0.75rem; color:#64748b; line-height:1.5; margin-bottom:0.75rem; height:45px; overflow:hidden; position:relative;">
                            ${c.desc}
                            <span onclick="Swal.fire({title:'Estrategia: ${c.label}', text:'${c.desc.replace(/'/g, "\\'")}', icon:'info'})" style="position:absolute; bottom:0; right:0; background:white; cursor:pointer; color:#3b82f6; font-weight:700; padding-left:10px;">Ver detalle</span>
                        </p>
                        
                        <div style="height: 1.2rem;"></div>

                        <button onclick="${c.items.length > 0 ? c.action : 'void(0)'}" 
                            data-tactica-key="${estado}-${idx + 1}"
                            ${(TACTICAS_APLICADAS.has(`${estado}-${idx + 1}`) || c.items.length === 0) ? 'disabled' : ''}
                            style="width:100%; height:45px; background:${TACTICAS_APLICADAS.has(`${estado}-${idx + 1}`) ? '#10b981' : (c.items.length === 0 ? '#94a3b8' : c.color)}; color:white; border:none; padding:10px; border-radius:10px; font-size:0.78rem; font-weight:900; cursor:pointer; box-shadow:0 6px 15px ${c.color}33; display:flex; align-items:center; justify-content:center; gap:8px; border:2px solid rgba(255,255,255,0.2); transition: all 0.3s; opacity: ${c.items.length === 0 && !TACTICAS_APLICADAS.has(`${estado}-${idx + 1}`) ? '0.6' : '1'};">
                            ${TACTICAS_APLICADAS.has(`${estado}-${idx + 1}`)
                ? '<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span> Táctica Aprobada'
                : (c.items.length === 0 ? '<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span> Sin stock en riesgo' : `<span></span> APLICAR A LOS ${c.items.length} PRODUCTOS`)}
                        </button>
                    </div>`;
    }).join('')}
                </div>

                <!-- COMPARATIVA FINANCIERA -->
                <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:1.25rem 2rem; margin-bottom:2rem; display:flex; justify-content:space-between; align-items:center; box-shadow:0 4px 6px rgba(0,0,0,0.02); position: relative; overflow: hidden;">
                    <div style="position:absolute; left:0; top:0; bottom:0; width:5px; background:linear-gradient(to bottom, #ef4444 0%, #10b981 100%); border-radius: 12px 0 0 12px;"></div>
                    <div style="flex: 1; padding-left:0.5rem;">
                        <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">
                            <span style="display:flex; align-items:center; opacity:0.8;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l3 1c.3 0 .5.1.7.3L11 11h2l4.3-4.7c.2-.2.4-.3.7-.3l3-1"></path><path d="M12 11v10"></path><path d="M3 21h18"></path></svg></span>
                            <p style="font-size:0.75rem; font-weight:800; color:#475569; text-transform:uppercase; margin:0; letter-spacing:0.05em;">Proyección Financiera</p>
                        </div>
                        <h4 style="margin:0; font-size:1.25rem; color:#1e293b; font-weight:800; line-height:1.2; margin-bottom:0.5rem;">Inacción vs Estrategias</h4>
                        <p style="margin:0; font-size:0.85rem; color:#64748b; line-height:1.4; max-width:96%;">${breakdownText}</p>
                    </div>
                    <div style="display:flex; gap:3rem; align-items:center;">
                        <div style="text-align:center;">
                            <p style="font-size:0.75rem; color:#ef4444; font-weight:800; margin:0 0 0.5rem 0; text-transform:uppercase; letter-spacing:0.05em;">
                                Sin Acción (Pérdida)
                            </p>
                            <p id="proyeccion-perdida-${estado}" data-value="${totalValor}" style="margin:0; font-size:2rem; font-weight:900; color:#ef4444; line-height:1; font-family: 'Inter', sans-serif; transition: color 0.4s ease;">-${fmtM(totalValor)}</p>
                            <p style="margin:0; font-size:0.7rem; color:#64748b; font-weight:700; margin-top:0.4rem;">100% Capital en Riesgo</p>
                        </div>
                        <div style="width:1px; height:60px; background:#e2e8f0;"></div>
                        <div style="text-align:center; position:relative;">
                            <div style="position:absolute; top:-10px; right: -5px; background:#10b981; color:white; font-size:0.6rem; font-weight:800; padding:2px 8px; border-radius:100px; text-transform:uppercase; letter-spacing:0.05em; transform:translateY(-8px); z-index:2; box-shadow:0 2px 4px rgba(16,185,129,0.3);">Óptimo</div>
                            <p style="font-size:0.75rem; color:#10b981; font-weight:800; margin:0 0 0.5rem 0; text-transform:uppercase; letter-spacing:0.05em; position:relative; z-index:1;">
                                Recupero Estimado
                            </p>
                            <p style="margin:0; font-size:2rem; font-weight:900; color:#10b981; line-height:1; font-family: 'Inter', sans-serif;">+${fmtM(recuperoCalculado)}</p>
                            <p style="margin:0; font-size:0.7rem; color:#64748b; font-weight:700; margin-top:0.4rem;">Capital Protegido Estimado</p>
                        </div>
                    </div>
                </div>
                `}

                ${treemapHtml}
                <div style="margin-top:2rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                        <p style="font-size:0.8rem; font-weight:800; color:#1e293b; text-transform:uppercase;">DISTRIBUCIÓN DEL TOP ${pareto.length} POR CATEGORÍA</p>
                    </div>
                    <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:flex-end; min-height:80px; padding:10px; background:#f8fafc; border-radius:10px; border:1px solid #e2e8f0;">
                        ${renderizarTreemapVencidos(pareto, container, estado)}
                    </div>
                </div>

                <div style="margin-top:2rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                        <p style="font-size:0.8rem; font-weight:800; color:#1e293b; text-transform:uppercase;">ANÁLISIS DE IMPACTO: TOP ${pareto.length} PRODUCTOS</p>
                        <div style="display:flex; gap:0.5rem; align-items:center;">
                            <span style="background:${cfg.color}; color:white; padding:4px 12px; border-radius:100px; font-size:0.75rem; font-weight:800; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
                                IMPACTO TOP ${pareto.length}: ${fmtM(sumTopPareto)} (${sumTopPct}% del Capital)
                            </span>
                        </div>
                    </div>
                    <div style="border-radius:12px; overflow:hidden; border:1px solid #e2e8f0;">
                        <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                            <thead><tr style="background:#f8fafc; color:#64748b; border-bottom:1px solid #e2e8f0;">
                                <th style="padding:10px; text-align:center;">#</th>
                                <th style="padding:10px; text-align:left;">Producto</th>
                                <th style="padding:10px; text-align:left;">Categoría</th>
                                <th style="padding:10px; text-align:center;">Días Vence</th>
                                <th style="padding:10px; text-align:right;">Stock</th>
                                <th style="padding:10px; text-align:right;">Impacto Financiero</th>
                                <th style="padding:10px; text-align:left;">Acumulado</th>
                            </tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>

                ${countS0 > 0 ? `
                <div style="margin-top:2rem; padding:1.5rem; background:#f0f9ff; border:1px solid #bae6fd; border-radius:16px;">
                    <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:1rem;">
                        <span style="display:flex; align-items:center; color:#0369a1;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg></span>
                        <div>
                            <p style="margin:0; font-size:0.8rem; font-weight:800; color:#0369a1; text-transform:uppercase;">Plan de Reorden / Reabastecimiento</p>
                            <h4 style="margin:0; color:#075985;">${countS0} productos con stock agotado en ${estado}</h4>
                        </div>
                        <button onclick="window.abrirPlanReorden()" style="margin-left:auto; background:#0ea5e9; color:white; border:none; padding:8px 16px; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.75rem; display:flex; align-items:center; gap:6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
                            Generar Sugerencia de Compra
                        </button>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:0.5rem;">
                        ${itemsSinStock.slice(0, 10).map(it => `
                            <div onclick="window.orderIndividual('${String(it.id_producto || it.nombre_producto).replace(/"/g, '&quot;')}')" style="background:white; padding:8px 12px; border-radius:8px; border:1px solid #e0f2fe; display:flex; justify-content:space-between; align-items:center; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.borderColor='#0ea5e9'" onmouseout="this.style.borderColor='#e0f2fe'">
                                <span style="font-size:0.75rem; font-weight:700; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${it.nombre_producto}</span>
                                <span style="font-size:0.65rem; background:#fee2e2; color:#ef4444; padding:2px 6px; border-radius:4px; font-weight:800;">REABASTECER</span>
                            </div>
                        `).join('')}
                        ${countS0 > 10 ? `<div style="text-align:center; padding:5px; font-size:0.7rem; color:#64748b;">+${countS0 - 10} más...</div>` : ''}
                    </div>
                </div>` : ''}
            </div>
        </div>`;

    container.insertAdjacentHTML('beforeend', html);
}

// Función para generar reporte de merma (CSV)
window.generarReporteMerma = function () {
    const vencidos = DATOS_CRUDOS.filter(i => (i.dias_riesgo_total ?? 0) <= -15);
    if (!vencidos.length) { alert("No hay productos en categoría Merma."); return; }
    const csv = ["Producto,Categoría,Stock,Valor,Días Vencido"]
        .concat(vencidos.map(i => `"${i.nombre_producto}","${i.categoria || ''}",${i.cantidad_stock || 0},${i.valor_stock || 0},${Math.abs(Math.round(i.dias_riesgo_total || 0))}`))
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `merma_inevitable_${new Date().toISOString().split('T')[0]}.csv`; a.click();
};

// Función para generar plan completo de vencidos
window.generarPlanVencidos = function () {
    const venc = DATOS_CRUDOS.filter(i => (i.estado_alerta || '') === 'VENCIDO');
    const { merma, donacion, reetiquetado } = agruparPorCategoriaAccion(venc);

    const rows = [
        ...merma.map(i => ({ ...i, accion_plan: "MERMA/DESTRUCCIÓN" })),
        ...donacion.map(i => ({ ...i, accion_plan: "DONACIÓN URGENTE" })),
        ...reetiquetado.map(i => ({ ...i, accion_plan: "RE-ETIQUETADO/CONTROL CALIDAD" }))
    ];
    const csv = ["Acción,Producto,Categoría,Sucursal,Stock,Valor CLP,Días Vencido"]
        .concat(rows.map(i => `"${i.accion_plan}","${i.nombre_producto}","${i.categoria || ''}","${i.nombre_ubicacion || ''}",${i.cantidad_stock || 0},${i.valor_stock || 0},${Math.abs(Math.round(i.dias_riesgo_total || 0))}`))
        .join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `plan_accion_vencidos_${new Date().toISOString().split('T')[0]}.csv`; a.click();

    showToast(`Plan exportado: ${merma.length} merma, ${donacion.length} donación, ${reetiquetado.length} re-etiquetado`, "success");
};

// Ejecución Masiva Directa desde Sugerencia IA
window.ejecutarAccionMasivaIA = async function (estado, aiLabel) {
    const normalize = (s) => (s || "NORMAL").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const STATE_MAP = { "VENCIDO": "VENCIDO", "CRITICO": "CRÍTICO", "URGENTE": "URGENTE", "PREVENTIVO": "PREVENTIVO" };

    // Filtrar items por el estado detectado en la recomendación
    const items = DATOS_CRUDOS.filter(i => STATE_MAP[normalize(i.estado_alerta)] === estado);

    if (!items.length) {
        showToast(`No se encontraron productos en estado ${estado} para aplicar esta acción.`, "warning");
        return;
    }

    const defaultDestino = aiLabel.toLowerCase().includes("donar") ? "Banco de Alimentos / ONG" : "Canal Estratégico Interno";
    const result = await Swal.fire({
        title: '¿Confirmar Estrategia?',
        html: `Vas a ejecutar la Estrategia Recomendada: <strong>'${aiLabel}'</strong>.<br>Se registrará el impacto para <strong>${items.length} productos</strong>.<br><br>
               <div style="text-align: left; margin-top: 10px;">
                   <label for="destino-input" style="font-weight: 700; font-size: 0.85rem; color: #475569;">Destino / Organización Receptora:</label>
                   <input type="text" id="destino-input" class="swal2-input" style="margin-top: 5px; height: 35px; font-size: 0.9rem;" value="${defaultDestino}" placeholder="Escribe el destino comercial o de donación">
               </div>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'Sí, ejecutar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const input = document.getElementById('destino-input');
            return input ? input.value : defaultDestino;
        }
    });

    if (!result.isConfirmed) return;
    const destinoFinal = result.value || defaultDestino;

    try {
        // AGREGACIÓN PROFESIONAL: Sumarizar miles de productos en un registro de "ACCIÓN MAESTRA"
        // Esto evita 4000+ filas individuales y permite que el Registro Maestro se vea limpio.
        const totalQty = items.reduce((sum, i) => sum + (i.cantidad_stock || 0), 0);
        const totalValue = items.reduce((sum, i) => sum + (i.valor_stock || 0), 0);
        const skuCount = items.length;

        const payload = [{
            id_producto: "MASIVO",
            nombre_producto: `ACCIÓN DE OPTIMIZACIÓN (${skuCount} SKUs)`,
            cantidad: totalQty,
            valor: totalValue,
            tipo: aiLabel.replace(/^IA:\s*"/, '').replace(/"$/, '').split(':')[0].trim() || aiLabel,
            organizacion: destinoFinal,
            detalles_agregados: `${skuCount} productos procesados masivamente vía análisis predictivo.`,
            fuente: window._analisisActivo || "",
            skus_afectados: items.map(i => ({ id_unico: i.id_unico, id: i.id_producto, qty: i.cantidad_stock }))
        }];

        const res = await fetch(`${API_URL}/api/donations/bulk`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${localStorage.getItem("token")}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast(`¡Estrategia Aplicada! ${items.length} productos gestionados.`, "success");

            items.forEach(i => {
                i.cantidad_stock = 0;
                i.valor_stock = 0;
                DONACIONES_RECIENTES.add(i.id_producto);
            });
            window._guardarPersistenciaTacticas();

            // Forzar actualización total
            window.actualizarInterfazLocal();

            setTimeout(() => {
                document.querySelector('.sidebar-item[data-tab="impacto-social"]')?.click();
                inicializarTablero();
            }, 1500); // Delay añadido
        } else {
            throw new Error("Error en API de proceso");
        }
    } catch (err) {
        console.error(err);
        showToast("Error ejecutando acción IA masiva.", "error");
    }
};

window.ejecutarAccionMasiva = async function (estado, catKey, btnElement = null) {
    // Normalizar para encontrar los items correctos del grupo
    const normalize = (s) => (s || "NORMAL").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const STATE_MAP = { "VENCIDO": "VENCIDO", "CRITICO": "CRÍTICO", "URGENTE": "URGENTE", "PREVENTIVO": "PREVENTIVO" };

    // Normalizar también el estado entrante (para que 'CRÍTICO' == 'CRITICO' lookup funcione)
    const estadoNorm = normalize(estado);
    const estadoReal = STATE_MAP[estadoNorm] || estado; // 'CRITICO' -> 'CRÍTICO'

    const todosCandidatos = DATOS_CRUDOS.filter(i => normalize(i.estado_alerta) === estadoNorm);
    const categories = agruparPorCategoriasDinamicas(todosCandidatos, estadoReal);
    const cat = categories[catKey];

    if (!cat || !cat.items.length) {
        showToast(`No hay productos aptos para '${cat?.label || 'esta acción'}' en este momento.`, "warning");
        return;
    }

    const accionFinal = cat.label;

    const defaultDestino = (accionFinal.includes("Donación") || accionFinal.includes("Donar")) ? "Banco de Alimentos / ONG" : "Canal Venta Rápida / Liquidación";
    const result = await Swal.fire({
        title: '¿Confirmar Táctica?',
        html: `Vas a aplicar <strong>'${accionFinal}'</strong> para <strong>${cat.items.length} productos</strong>.<br>Esta acción descontará el inventario en riesgo.<br><br>
               <div style="text-align: left; margin-top: 10px;">
                   <label for="destino-input-2" style="font-weight: 700; font-size: 0.85rem; color: #475569;">Destino / Organización Receptora:</label>
                   <input type="text" id="destino-input-2" class="swal2-input" style="margin-top: 5px; height: 35px; font-size: 0.9rem;" value="${defaultDestino}" placeholder="Escribe el destino comercial o de donación">
               </div>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'Sí, aplicar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const input = document.getElementById('destino-input-2');
            return input ? input.value : defaultDestino;
        }
    });

    if (!result.isConfirmed) return;
    const destinoFinal = result.value || defaultDestino;

    try {
        // Simulamos un retraso visual del procesamiento IA
        btnElement.style.opacity = "0.7";
        btnElement.innerHTML = "⏳ Procesando...";

        // Calcular impacto proyectado
        let r = 0;
        if (estado === "VENCIDO") {
            if (catKey === "cat1") r = 0.27; else if (catKey === "cat2") r = 0.35; else if (catKey === "cat3") r = 1.0;
        } else if (estado === "CRÍTICO") {
            if (catKey === "cat1") r = 0.30; else if (catKey === "cat2") r = 0.35; else if (catKey === "cat3") r = 0.50;
        } else if (estado === "URGENTE") {
            if (catKey === "cat1") r = 0.70; else if (catKey === "cat2") r = 0.35; else if (catKey === "cat3") r = 0.60;
        } else if (estado === "PREVENTIVO") {
            if (catKey === "cat1") r = 0.85; else if (catKey === "cat2") r = 0.50; else if (catKey === "cat3") r = 1.0;
        }

        const totalVal = cat.items.reduce((s, i) => s + (i.valor_stock || 0), 0);
        const totalQty = cat.items.reduce((s, i) => s + (i.cantidad_stock || 0), 0);
        const recupero = totalVal > 0 ? (totalVal * r) : 0;

        // AGREGACIÓN PROFESIONAL: Sumarizamos los items en un único "Registro Maestro"
        // para no colapsar el historial con miles de filas individuales.
        const skuCount = cat.items.length;
        const payload = [{
            id_producto: "MASIVO",
            nombre_producto: `IA: ACCIÓN TÁCTICA (${skuCount} SKUs)`,
            tipo: accionFinal,
            cantidad: totalQty,
            valor: totalVal,
            organizacion: destinoFinal,
            detalles_agregados: `${skuCount} productos procesados masivamente vía Táctica IA.`,
            fuente: window._analisisActivo || "",
            skus_afectados: cat.items.map(i => ({
                id_unico: i.id_unico,
                sku: i.id_producto,
                producto: i.nombre_producto,
                cantidad: i.cantidad_stock,
                proveedor: i.proveedor || "N/A",
                marca: i.marca || i.brand || "N/A",
                ubicacion: i.nombre_ubicacion || "N/A",
                valor: (i.valor_stock || 0).toFixed(0),
                categoria: i.categoria || "N/A"
            }))
        }];

        const res = await fetch(`${API_URL}/api/donations/bulk`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${localStorage.getItem("token")}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error("Fallo al registrar impacto en origen");

        // 1. Registrar items localmente
        // Hacemos que el stock y valor baje a 0 para que salgan del conteo de riesgo
        // (ya están "tratados") y las métricas bajen. Pasan a Reorden.
        cat.items.forEach(i => {
            i.cantidad_stock = 0;
            i.valor_stock = 0;
            DONACIONES_RECIENTES.add(i.id_producto);
        });

        // Registrar que esta táctica masiva ya se aplicó
        TACTICAS_APLICADAS.add(`${estado}-${catKey.replace('cat', '')}`);
        window._guardarPersistenciaTacticas();

        // 2. Re-renderizar la interfaz
        window.actualizarInterfazLocal();

        // 3. Lanzar recarga del servidor en background con delay
        setTimeout(() => {
            inicializarTablero();
            cargarImpactoSocial();
        }, 1500);
        Swal.fire({
            title: 'Impacto Estratégico',
            html: `
                <div style="text-align: left; padding: 10px;">
                    <p style="margin: 0 0 1rem 0; font-size: 0.95rem; color: #475569;">Se ha ejecutado la acción <strong>${cat.label}</strong> para <strong>${skuCount.toLocaleString('es-CL')} SKUs</strong>.</p>
                    
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 1.25rem; border-radius: 8px; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items:center;">
                        <div>
                            <p style="margin: 0 0 0.2rem 0; font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Capital Comprometido</p>
                            <p style="margin: 0; font-size: 1.25rem; font-weight: 800; color: #1e293b;">${fmtExact(totalVal)}</p>
                        </div>
                        <div style="height:30px; width:1px; background:#cbd5e1;"></div>
                        <div style="text-align: right;">
                            <p style="margin: 0 0 0.2rem 0; font-size: 0.75rem; color: #10b981; font-weight: 700; text-transform: uppercase;">Recupero Estimado (${Math.round(r * 100)}%)</p>
                            <p style="margin: 0; font-size: 1.4rem; font-weight: 900; color: #10b981; text-shadow:0 0 10px rgba(16,185,129,0.2);">+${fmtExact(recupero)}</p>
                        </div>
                    </div>

                    <p style="margin: 0; font-size: 0.8rem; color: #0284c7; background: #f0f9ff; padding: 8px; border-radius: 6px; line-height:1.4;">
                        ✅ <strong>Todo listo:</strong> Esta decisión táctica ya fue registrada formalmente. Acabamos de enviarla al <strong>Registro Maestro de Acciones de Sostenibilidad</strong>.
                    </p>
                </div>
            `,
            icon: 'success',
            confirmButtonColor: '#10b981',
            confirmButtonText: 'Ver en Registro',
        }).then((result) => {
            // 4. Navegar a Registro solo si el usuario confirmó (no si cerró con X)
            if (result.isConfirmed) {
                const btnImpacto = document.querySelector('.sidebar-item[data-tab="impacto-social"]');
                if (btnImpacto) btnImpacto.click();
            }
        });

    } catch (err) {
        console.error("❌ Error en ejecutarAccionMasiva:", err);
        showToast("Error aplicando y procesando la acción táctica.", "error");
    }
};

function agruparPorCategoriasDinamicas(items, estado) {
    const res = {
        cat1: { items: [], label: "", icon: "", color: "", desc: "", action: "", btn: "" },
        cat2: { items: [], label: "", icon: "", color: "", desc: "", action: "", btn: "" },
        cat3: { items: [], label: "", icon: "", color: "", desc: "", action: "", btn: "" }
    };

    const themeColor = ESTADO_CONFIG[estado]?.color || "#64748b";

    // HU-PROTOCOLO: Actualizar labels y protocolos según Base de Datos de Packs y Seguridad
    if (estado === "VENCIDO") {
        res.cat1 = { label: "Saneamiento y Baja Fiscal", icon: "📑", color: themeColor, desc: "Protocolo de merma legal (Ley 27° LIR). Solo productos con alertas sanitarias registradas.", items: [], action: "window.ejecutarAccionMasiva('VENCIDO', 'cat1', this)", btn: "📄 Reportar Baja" };
        res.cat2 = { label: "Donación Altruista", icon: "🤝", color: themeColor, desc: "Lotes seguros según Protocolos de Seguridad. Recupero de IVA mediante donación social.", items: [], action: "window.ejecutarAccionMasiva('VENCIDO', 'cat2', this)", btn: "🤝 Enviar Donación" };
        res.cat3 = { label: "Auditoría de Lote", icon: "🔍", color: themeColor, desc: "Validación de spoilage físico. Si no hay olor/gas, evaluar re-etiquetado según normativa.", items: [], action: "window.ejecutarAccionMasiva('VENCIDO', 'cat3', this)", btn: "🔍 Validar Estado" };
    } else if (estado === "CRÍTICO") {
        res.cat1 = { label: "Venta Flash (Blitz)", icon: "🔥", color: themeColor, desc: "Liquidación agresiva (70%) en 'Góndola de Oportunidad'. Solo consumo inmediato.", items: [], action: "window.ejecutarAccionMasiva('CRÍTICO', 'cat1', this)", btn: "🔥 Liquidar Ya" };
        res.cat2 = { label: "Donación Proactiva", icon: "🌱", color: themeColor, desc: "Asegurar deducibilidad total donando antes del vencimiento (Sello de Calidad).", items: [], action: "window.ejecutarAccionMasiva('CRÍTICO', 'cat2', this)", btn: "🌱 Donar Lote" };
        res.cat3 = { label: "Pack Rescate", icon: "🧩", color: themeColor, desc: "Implementar 'Mega Pack Parrillero' o 'Canasta Agro-Eco' según categoría profesional.", items: [], action: "window.ejecutarAccionMasiva('CRÍTICO', 'cat3', this)", btn: "🧩 Crear Pack" };
    } else if (estado === "URGENTE") {
        res.cat1 = { label: "Estrategia Combo", icon: "📦", color: themeColor, desc: "Cruzar con complementos de alta rotación (ej. 'Noche de Pizza'). Ver Catálogo de Packs.", items: [], action: "window.ejecutarAccionMasiva('URGENTE', 'cat1', this)", btn: "📦 Armar Combo" };
        res.cat2 = { label: "Sello Sustentable", icon: "📗", color: themeColor, desc: "Relocalizar al frente de góndola con sello de 'Consumo Preferente'.", items: [], action: "window.ejecutarAccionMasiva('URGENTE', 'cat2', this)", btn: "📗 Reubicar" };
        res.cat3 = { label: "Descuento 40%", icon: "💰", color: themeColor, desc: "Incentivo financiero estandarizado para movilizar stock inmovilizado.", items: [], action: "window.ejecutarAccionMasiva('URGENTE', 'cat3', this)", btn: "💰 Bajar Precio" };
    } else if (estado === "PREVENTIVO") {
        res.cat3 = { label: "Monitoreo Demanda", icon: "📊", color: themeColor, desc: "Modelo predictivo analizando elasticidad. Si la demanda cae, activar preventa dinámica.", items: [], action: "window.ejecutarAccionMasiva('PREVENTIVO', 'cat3', this)", btn: "📊 Analizar" };
        res.cat2 = { label: "Gestión Circular", icon: "♻️", color: themeColor, desc: "Optimización de flujo para meta residuo cero. Prioridad reposición Clase B.", items: [], action: "window.ejecutarAccionMasiva('PREVENTIVO', 'cat2', this)", btn: "♻️ Gestionar" };
        res.cat1 = { label: "Impulso Digital", icon: "🚀", color: themeColor, desc: "Notificación push a clientes frecuentes y banners en cabecera de App.", items: [], action: "window.ejecutarAccionMasiva('PREVENTIVO', 'cat1', this)", btn: "🚀 Promocionar" };
    } else if (estado === "REORDEN") {
        res.cat1 = { label: "Reposición Optimizada", icon: "📦", color: themeColor, desc: "Cálculo de lote económico basado en previsión de demanda IA.", items: [], action: "window.ejecutarAccionMasiva('REORDEN', 'cat1', this)", btn: "📦 Comprar" };
    }

    // PARTICIÓN EXCLUSIVA (HU-ONE-SOLO): Cada item va a UNA sola categoría por orden de prioridad
    items.forEach(i => {
        const demanda = i.demanda_diaria || 0;
        const valor = i.valor_stock || 0;
        const dias = i.dias_riesgo_total || 0;

        if (estado === "VENCIDO") {
            if (dias <= -15) res.cat1.items.push(i);
            else if (demanda >= 0.1) res.cat2.items.push(i);
            else res.cat3.items.push(i);
        } else if (estado === "CRÍTICO") {
            if (valor < 100000 && demanda <= 0.8) res.cat3.items.push(i); // Prioridad bajo valor -> Pack
            else if (demanda > 0.8) res.cat1.items.push(i); // Alta rotación -> Flash
            else res.cat2.items.push(i); // Resto -> Donación
        } else if (estado === "URGENTE") {
            if (valor > 150000) res.cat1.items.push(i); // High value -> Combo
            else if (demanda < 0.4) res.cat2.items.push(i); // Low demand -> Donación
            else res.cat3.items.push(i); // Resto -> Descuento
        } else if (estado === "PREVENTIVO") {
            if (demanda >= 0.6) res.cat3.items.push(i); // Stable -> IA
            else if (valor > 100000) res.cat2.items.push(i); // Valuable -> Salud
            else res.cat1.items.push(i); // Low demand/value -> Oferta
        } else if (estado === "REORDEN") {
            res.cat1.items.push(i);
        }
    });

    // Fallback para otros estados (Normal, etc)
    if (!res.cat1.label) {
        res.cat1 = { label: "Vigilancia", icon: "", color: "#64748b", desc: "Estado saludable.", items: items, action: "alert('OK')", btn: "📊 Status" };
    }

    return res;
}

function renderizarTabla(data) {
    const container = document.getElementById("cuerpo-tabla-inventario");
    if (!container) return;

    // HU-FILTRO: Mantener items incluso con stock 0 para que la Vista de Crisis
    // pueda mostrar las tarjetas como 'APROBADAS'. Los totales se filtran luego.
    const dataFiltrada = data;

    // Agrupar por estado_alerta (Normalizando para evitar fallos por acentos/case)
    const normalize = (s) => (s || "NORMAL").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // ... rest of the function using dataFiltrada ...

    // Mapeo inverso de Normalizado -> Key Real en ESTADO_CONFIG
    const STATE_MAP = {
        "REORDEN": "CRÍTICO",
        "REPUESTO": "CRÍTICO",
        "VENCIDO": "VENCIDO",
        "CRITICO": "CRÍTICO",
        "URGENTE": "URGENTE",
        "PREVENTIVO": "PREVENTIVO",
        "NORMAL": "NORMAL"
    };

    const grupos = {
        "VENCIDO": [],
        "CRÍTICO": [],
        "URGENTE": [],
        "PREVENTIVO": [],
        "NORMAL": []
    };

    dataFiltrada.forEach(item => {
        if (parseFloat(item.cantidad_stock || 0) <= 0) {
            grupos["CRÍTICO"].push(item);
            return;
        }
        const raw = item.estado_alerta || "NORMAL";
        const normalized = normalize(raw);
        const estado = STATE_MAP[normalized] || "NORMAL";

        if (grupos[estado]) {
            grupos[estado].push(item);
        } else {
            if (!grupos["NORMAL"]) grupos["NORMAL"] = [];
            grupos["NORMAL"].push(item);
        }
    });

    // Ordenar estados
    const estadosOrdenados = Object.keys(grupos).sort((a, b) => {
        const oa = ESTADO_CONFIG[a]?.orden ?? 9;
        const ob = ESTADO_CONFIG[b]?.orden ?? 9;
        return oa - ob;
    });

    container.innerHTML = "";

    estadosOrdenados.forEach(estado => {
        if (estado === "REORDEN") return; // HU: REORDEN vive en la pestaña 'Demanda' ahora.

        let items = grupos[estado];
        if (!items || items.length === 0) return;

        // HU-COHERENCIA: Si la táctica ya fue aplicada, esos items no deben sumar en los headers
        // pero queremos que sigan apareciendo en la 'VISTA DE CRISIS' con el check verde.
        // Por lo tanto, agruparPorCategoriasDinamicas nos servirá para saber qué items SON de qué táctica.
        const cats = agruparPorCategoriasDinamicas(items, estado);

        // Calcular totales REALES sumando todos los items que aún tienen stock
        // (Nota: los de stock 0 ya fueron filtrados a REORDEN en el paso anterior, pero recalculamos por seguridad)
        const totalUnidades = items.reduce((s, i) => s + parseFloat(i.cantidad_stock || 0), 0);
        const totalValor = items.reduce((s, i) => s + parseFloat(i.valor_stock || 0), 0);
        const itemsConStock = items.filter(it => parseFloat(it.cantidad_stock || 0) > 0);
        const countProd = itemsConStock.length;

        // HU-COHERENCIA: Si no hay stock real en este estado (todo fue tratado), ocultar la categoría
        if (countProd === 0 && totalUnidades <= 0) return;

        const cfg = ESTADO_CONFIG[estado] || { color: "#6b7280", bg: "#f9fafb", dot: "#6b7280" };
        const acordeonId = `grupo-${estado.replace(/[^a-z]/gi, '')}`;
        const pillStyle = `display:inline-flex; align-items:center; gap:0.25rem; background:rgba(255,255,255,0.6); border:1px solid ${cfg.color}22; padding:0.2rem 0.55rem; border-radius:999px; font-size:0.8rem; color:#374151;`;

        // ============ VISTA DE CRISIS Dinámica ============
        const esCrisis = !window._mostrarTablaVencidosCompleta;

        if (esCrisis) {
            const grupoCrisisHeader = `
            <div style="margin-bottom:0.75rem; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.06);">
                <div id="${acordeonId}-header"
                    style="cursor:pointer; background:${cfg.bg}; border-left:4px solid ${cfg.color}; padding:0.85rem 1.25rem; display:flex; flex-wrap:wrap; align-items:center; gap:0.75rem; user-select:none; min-height:56px;">
                    <div style="display:flex; align-items:center; gap:0.75rem; flex-shrink:0;" onclick="document.getElementById('${acordeonId}').style.display = document.getElementById('${acordeonId}').style.display==='none'?'block':'none'">
                        <span style="width:10px; height:10px; border-radius:50%; background:${cfg.dot}; flex-shrink:0;"></span>
                        <span style="font-weight:800; color:${cfg.color}; font-size:0.95rem; letter-spacing:0.02em;">${estado === "NORMAL" ? "SALUDABLE" : estado}</span>
                    </div>
                    <div style="display:flex; gap:0.4rem; flex-wrap:wrap; flex:1; min-width:200px;" onclick="document.getElementById('${acordeonId}').style.display = document.getElementById('${acordeonId}').style.display==='none'?'block':'none'">
                        ${estado === "REORDEN" ?
                    `<span style="${pillStyle}; background:#eff6ff; border-color:#3b82f644; color:#2563eb;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px;"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
                        ${countStock0} SKUs SIN STOCK
                    </span>` :
                    `<span style="${pillStyle}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${cfg.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.8;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                        ${countProd.toLocaleString('es-CL')} activos
                    </span>
                    <span style="${pillStyle}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${cfg.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.8;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
                        ${totalUnidades.toLocaleString('es-CL')} uds
                    </span>
                    <span style="${pillStyle}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${cfg.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.8;"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                        ${fmtExact(totalValor)}
                    </span>`
                }
                        <span style="background:${cfg.color}15; color:${cfg.color}; padding:0.25rem 0.65rem; border-radius:100px; font-size:0.75rem; font-weight:800; border:1px solid ${cfg.color}30; white-space:nowrap;">${estado === 'REORDEN' ? 'PLAN COMPRAS' : 'VISTA DE CRISIS'}</span>
                    </div>
                    <span style="color:${cfg.color}; font-size:0.85rem; padding:0 0.5rem; margin-left:auto;" onclick="document.getElementById('${acordeonId}').style.display = document.getElementById('${acordeonId}').style.display==='none'?'block':'none'">▼</span>
                </div>
                <div id="${acordeonId}" style="display:none;">`;

            container.insertAdjacentHTML('beforeend', grupoCrisisHeader);
            const crisisContainer = document.getElementById(acordeonId);
            renderizarVistaCrisis(items, crisisContainer, estado);
            container.insertAdjacentHTML('beforeend', `</div></div>`);
            return;
        }
        // =====================================================================
        // Ordenar: Stock > 0 primero, luego por valor desc. Stock 0 al final.
        const itemsOrdenados = [...items].sort((a, b) => {
            const sA = parseFloat(a.cantidad_stock || 0);
            const sB = parseFloat(b.cantidad_stock || 0);
            if (sA > 0 && sB <= 0) return -1;
            if (sA <= 0 && sB > 0) return 1;
            return (b.valor_stock || 0) - (a.valor_stock || 0);
        });

        // Renderizado normal (no crisis) - LIMITAR A 100 PARA FLUIDEZ TOTAL (HU-OPT)
        const itemsAMostrar = itemsOrdenados.slice(0, 100);

        const filas = itemsAMostrar.map(item => {
            const nombreProd = item.nombre_producto || "Sin Nombre";
            const normName = nombreProd.split(' ')[0].toLowerCase().trim();
            const iaPlan = window.IA_PLAN_ACCION ? window.IA_PLAN_ACCION[normName] : null;
            const iaGlobal = window.IA_PLAN_ACCION_GLOBAL_APLICADO && window.IA_PLAN_ACCION_GLOBAL[estado] ? window.IA_PLAN_ACCION_GLOBAL[estado].titulo : null;

            let fallbackAccion = "MONITOREAR";
            const rotaAlta = (item.demanda_diaria || 0) > 0.8;
            const valorAlto = (item.valor_stock || 0) > 200000;

            const riesgo = item.dias_riesgo_total;
            const fg = item.forecast_quiebre_dias;
            const diasNum = (riesgo !== null && riesgo !== undefined && Math.abs(riesgo) < 999) ? riesgo
                : (fg !== null && fg !== undefined && fg < 999) ? fg : null;

            // Unificar lógica de acción con el nivel de riesgo real (días)
            const riesgoCalculado = (diasNum !== null && diasNum <= 0) ? "VENCIDO" :
                (diasNum !== null && diasNum <= 7) ? "CRÍTICO" :
                    (diasNum !== null && diasNum <= 15) ? "URGENTE" : "PREVENTIVO";

            if (riesgoCalculado === "VENCIDO") fallbackAccion = "RETIRO INM.";
            else if (riesgoCalculado === "CRÍTICO") fallbackAccion = rotaAlta ? "VENTA FLASH" : "DONAR HOY";
            else if (riesgoCalculado === "URGENTE") fallbackAccion = valorAlto ? "PACK COMBO" : "DSCTO. 40%";
            else if (riesgoCalculado === "PREVENTIVO") fallbackAccion = rotaAlta ? "MANTENER" : "VISIBILIZAR";

            const accion = iaPlan ? iaPlan.label : (iaGlobal || item.accion_sugerida || fallbackAccion);

            const stockActual = item.cantidad_stock ?? 0;
            const idProd = item.id_producto;
            const sucursal = item.nombre_ubicacion || "—";
            const valor = item.valor_stock || 0;
            const precioUnit = item.precio_unitario != null ? Number(item.precio_unitario) : null;
            const costoUnit = item.costo_unitario != null ? Number(item.costo_unitario) : null;
            const fmtDecimal = (v) => v != null ? `$${v.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '—';

            const diagDias = diasNum !== null ? Math.round(diasNum) : "—";
            let classAlerta = "";
            let valVisualDias = diagDias;
            if (diasNum !== null && diasNum <= 0) { classAlerta = "animate-pulse-bg text-white font-bold rounded px-2 py-1"; valVisualDias = `⚠️ ${diagDias} (VENCIDO)`; }
            else if (diasNum !== null && diasNum <= 7) { classAlerta = "bg-red-500 text-white font-bold rounded px-2 py-1"; valVisualDias = `🔥 ${diagDias} (CRÍTICO)`; }
            else if (diasNum !== null && diasNum <= 15) { classAlerta = "text-orange-600 font-bold"; }
            else { classAlerta = "text-gray-700 font-medium"; }

            let btnStyle = "border:1px solid #e5e7eb; background:white; color:#374151;";
            if (window.IA_PLAN_ACCION_GLOBAL_APLICADO && iaGlobal) btnStyle = "background:#9333ea; color:white; border:none; box-shadow: 0 0 10px rgba(147, 51, 234, 0.3);";
            else if (estado === "VENCIDO") btnStyle = "background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid #ef4444;";
            else if (estado === "CRÍTICO") btnStyle = "background:rgba(249,115,22,0.15); color:#f97316; border:1px solid #f97316;";
            else if (estado === "URGENTE") btnStyle = "background:#ffedd5; color:#9a3412; border:none;";
            else if (estado === "PREVENTIVO") btnStyle = "background:#fef3c7; color:#92400e; border:none;";

            return `
                <tr>
                    <td style="font-weight:500; padding:0.6rem 0.8rem;">${nombreProd}</td>
                    ${hasSucursal ? `<td style="padding:0.6rem 0.8rem; color:#6b7280;">${sucursal}</td>` : ''}
                    <td style="text-align:center; font-weight:700; padding:0.6rem 0.8rem;">${(stockActual || 0).toLocaleString('es-CL')}</td>
                    <td style="text-align:center; padding:0.6rem 0.8rem;"><span class="${classAlerta}">${valVisualDias}</span></td>
                    <td style="text-align:right; padding:0.6rem 0.4rem; color:#6b7280; font-size:0.82rem;">${fmtDecimal(costoUnit)}</td>
                    <td style="text-align:right; padding:0.6rem 0.4rem; color:#374151; font-size:0.82rem;">${fmtDecimal(precioUnit)}</td>
                    <td style="padding:0.6rem 0.8rem; font-weight:600; color:${stockActual <= 0 ? '#94a3b8' : 'inherit'};">
                        ${fmtDecimal(valor)}
                        ${stockActual <= 0 ? '<br><small style="font-size:0.65rem; color:#ef4444; font-weight:800;">(STOCK CERO)</small>' : ''}
                    </td>
                    <td style="padding:0.6rem 0.8rem; display: flex; gap: 0.5rem; justify-content: center;">
                        <button style="${btnStyle} cursor:pointer; padding:5px 12px; border-radius:6px; font-size:0.75rem; font-weight:700; text-transform:uppercase; transition:all 0.2s; display:flex; align-items:center; gap:6px;"
                            onclick="document.querySelector('.sidebar-item[data-tab=\'sensibilidad\']').click(); cargarSimulacionProducto('${idProd}', '${nombreProd}');"
                            title="Ver previsión detallada y escenarios de demanda">
                            <span>📈</span> ${accion}
                        </button>
                        ${(estado === "VENCIDO" || estado === "CRÍTICO" || estado === "URGENTE") ? `
                        <button style="${DONACIONES_RECIENTES.has(idProd) ? 'background:#059669; color:white;' : 'background: rgba(16, 185, 129, 0.1); color: #059669;'} border: 1px solid #10b981; cursor:pointer; padding:5px 10px; border-radius:6px; font-size:0.72rem; font-weight:700; text-transform:uppercase;"
                            ${DONACIONES_RECIENTES.has(idProd) ? 'disabled' : ''}
                            onclick="ejecutarDonacionManual('${idProd}', '${nombreProd}', ${stockActual}, this)">
                            ${DONACIONES_RECIENTES.has(idProd) ? 'TRATADO ✅' : 'Tratar Producto 🤔'}
                        </button>` : ''}
                    </td>
                </tr>`;
        }).join("");

        const grupoHtml = `
        <div style="margin-bottom:0.75rem; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.06);">
            <div onclick="toggleGrupo('${acordeonId}')" style="cursor:pointer; background:${cfg.bg}; border-left:4px solid ${cfg.color}; padding:0.85rem 1.2rem; display:flex; align-items:center; gap:0.75rem; user-select:none;">
                <span style="width:10px; height:10px; border-radius:50%; background:${cfg.dot}; flex-shrink:0;"></span>
                <span style="font-weight:700; color:${cfg.color}; font-size:0.95rem;">${estado}</span>
                <div style="display:flex; gap:0.4rem; flex-wrap:wrap; flex:1;">
                    <span style="${pillStyle}">📦 ${items.length} prod.</span>
                    <span style="${pillStyle}">🏷️ ${totalUnidades.toLocaleString('es-CL')} uds</span>
                    <span style="${pillStyle}">💲${fmtExact(totalValor)}</span>
                </div>
                <span id="arrow-${acordeonId}" style="color:${cfg.color}; font-size:0.85rem; transition:transform 0.2s; ${GRUPOS_ABIERTOS.has(acordeonId) ? 'transform:rotate(180deg);' : ''}">▼</span>
            </div>
            <div id="${acordeonId}" style="display:${GRUPOS_ABIERTOS.has(acordeonId) ? 'block' : 'none'}; background:white;">
                <table style="width:100%; border-collapse:collapse; font-size:0.875rem;">
                    <thead>
                        <tr style="background:${cfg.color}; color:white;">
                            <th style="padding:0.6rem 0.8rem; text-align:left; font-weight:600;">Producto</th>
                            ${hasSucursal ? '<th style="padding:0.6rem 0.8rem; text-align:left; font-weight:600;">Sucursal</th>' : ''}
                            <th style="padding:0.6rem 0.8rem; text-align:center; font-weight:600;">Stock (uds)</th>
                            <th style="padding:0.6rem 0.8rem; text-align:center; font-weight:600;">Días Vencer</th>
                            <th style="padding:0.6rem 0.8rem; text-align:right; font-weight:600; opacity:0.85;">Costo Unit.</th>
                            <th style="padding:0.6rem 0.8rem; text-align:right; font-weight:600; opacity:0.85;">Precio Unit.</th>
                            <th style="padding:0.6rem 0.8rem; text-align:left; font-weight:600;">Valor Stock (CLP)</th>
                            <th style="padding:0.6rem 0.8rem; text-align:center; font-weight:600;">Acción</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                    ${items.length > 100 ? `
                        <tr style="background:#f1f5f9;">
                            <td colspan="${hasSucursal ? 8 : 7}" style="padding:1rem; text-align:center; color:#64748b; font-style:italic; font-size:0.8rem;">
                                💡 Mostrando los 100 lotes con mayor impacto económico. Use el buscador para encontrar ítems específicos.
                            </td>
                        </tr>
                    ` : ''}
                    <tfoot>
                        <tr style="background:${cfg.bg}; border-top:2px solid ${cfg.color};">
                            <td colspan="${hasSucursal ? 2 : 1}" style="padding:0.6rem 0.8rem; font-weight:700; color:${cfg.color};">📊 TOTAL GRUPO</td>
                            <td style="text-align:center; padding:0.6rem 0.8rem; font-weight:700; color:#374151;">${totalUnidades.toLocaleString('es-CL')} uds</td>
                            <td style="padding:0.6rem 0.8rem;"></td>
                            <td style="padding:0.6rem 0.8rem;"></td>
                            <td style="padding:0.6rem 0.8rem;"></td>
                            <td style="padding:0.6rem 0.8rem; font-weight:800; color:${cfg.color}; font-size:1rem;">${fmtExact(totalValor)} en riesgo</td>
                            <td style="padding:0.6rem 0.8rem;"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>`;
        container.insertAdjacentHTML('beforeend', grupoHtml);
    });
}

function toggleGrupo(id) {
    const el = document.getElementById(id);
    const arrow = document.getElementById(`arrow-${id}`);
    if (!el) return;
    const isNowOpen = el.style.display === "none";

    if (isNowOpen) {
        el.style.display = "block";
        GRUPOS_ABIERTOS.add(id);
        if (arrow) arrow.style.transform = "rotate(180deg)";
    } else {
        el.style.display = "none";
        GRUPOS_ABIERTOS.delete(id);
        if (arrow) arrow.style.transform = "rotate(0deg)";
    }
}


/**
 * renderMap — Punto de entrada para la sección de Logística/Sucursales.
 *
 * Columnas aprovechadas del inventario:
 *   - nombre_ubicacion : Nombre humano de la tienda/bodega/sucursal (REQUERIDO)
 *   - latitud / longitud: Coordenadas geográficas (OPCIONALES)
 *     → Si existen > 0 ítems con lat+lon, se muestra el mapa Leaflet.
 *     → Si NO existen, se muestra una tabla de sucursales con métricas.
 *   - cantidad_stock   : Unidades disponibles en esa ubicación
 *   - estado_alerta    : Estado calculado (VENCIDO / CRÍTICO / URGENTE / PREVENTIVO / NORMAL)
 *   - nombre_producto  : Para el popup del marcador en el mapa
 *
 * Próxima actualización: 30 días a partir de window.HOY (fecha real del sistema).
 */
function renderMap(data) {
    if (!data || data.length === 0) return;

    // Determinar si el dataset tiene coordenadas geográficas reales
    const hasGeo = data.some(item => {
        const lat = parseFloat(item.latitud);
        const lon = parseFloat(item.longitud);
        return !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0;
    });

    // Renderizar badge de "Próxima actualización"
    _renderProximaActualizacion();

    if (hasGeo) {
        // Caso A: Dataset con geo → Mapa interactivo
        inicializarMapa(data);
    } else {
        // Caso B: Dataset sin geo pero con sucursales → Tabla de métricas por ubicación
        _renderTablaSucursales(data);
    }
}

/**
 * Muestra el badge indicando cuándo vence el período de análisis actual
 * (hoy + 30 días calendario). Se actualiza cada vez que se carga el mapa.
 */
function _renderProximaActualizacion() {
    const badge = document.getElementById('planner-next-update');
    if (!badge) return;
    const hoy = new Date();
    const next = new Date(hoy);
    next.setDate(next.getDate() + 30);
    const fmt = (d) => d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    badge.textContent = `🔄 Próxima actualización sugerida: ${fmt(next)}`;
    badge.style.display = 'inline-block';
}

/**
 * _renderTablaSucursales — Cuando el dataset no tiene latitud/longitud,
 * agrupa los datos por nombre_ubicacion y muestra una grilla de tarjetas en
 * el elemento #branch-table-view (sibling de #mainMap).
 *
 * ¿Por qué NO escribir en #mainMap?
 *   Leaflet aplica overflow:hidden + height:100% al contenedor del mapa.
 *   Cualquier HTML inyectado ahí queda invisible. Por eso usamos un div hermano.
 *
 * Columnas requeridas: nombre_ubicacion, cantidad_stock, estado_alerta
 */
function _renderTablaSucursales(data) {
    const tableEl = document.getElementById('branch-table-view');
    const mapEl = document.getElementById('mainMap');
    if (!tableEl) return;

    // Cambiar visibilidad: mostrar tabla, ocultar mapa Leaflet
    if (mapEl) mapEl.style.display = 'none';
    tableEl.style.display = 'block';
    // Permitir que el wrapper crezca verticalmente en modo tabla
    const wrapper = tableEl.closest('.map-wrapper');
    if (wrapper) wrapper.classList.add('no-geo-mode');


    // Agrupar por ubicación genéricamente
    const byLocation = {};
    data.forEach(item => {
        const loc = (item.nombre_ubicacion || '').trim() || 'Sin ubicación asignada';
        if (!byLocation[loc]) byLocation[loc] = { skus: 0, stockTotal: 0, criticos: 0 };
        byLocation[loc].skus++;
        byLocation[loc].stockTotal += parseFloat(item.cantidad_stock) || 0;
        const estado = (item.estado_alerta || '').toUpperCase();
        if (estado === 'VENCIDO' || estado === 'CRÍTICO') byLocation[loc].criticos++;
    });

    const ubicaciones = Object.entries(byLocation);
    if (ubicaciones.length === 0) {
        tableEl.innerHTML = `<div style="padding:3rem; text-align:center; color:#94a3b8;">No hay datos de ubicación en este dataset.</div>`;
        return;
    }

    // Color semáforo basado en ratio de items críticos vs total de SKUs en la ubicación
    const _colorBySeverity = (criticos, total) => {
        const ratio = total > 0 ? criticos / total : 0;
        if (ratio > 0.3) return { bg: '#fff5f5', border: '#fca5a5', text: '#dc2626', label: 'Crítica' };
        if (ratio > 0.1) return { bg: '#fffbeb', border: '#fcd34d', text: '#d97706', label: 'En Riesgo' };
        return { bg: '#f0fdf4', border: '#86efac', text: '#16a34a', label: 'Saludable' };
    };

    let html = `
        <div style="margin-bottom:0.75rem;">
            <p style="margin:0; font-size:0.78rem; color:#94a3b8; font-weight:600;">
                📋 Dataset sin coordenadas geográficas — vista de métricas por ubicación
            </p>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:0.75rem;">
    `;

    ubicaciones
        .sort(([, a], [, b]) => b.criticos - a.criticos) // Más críticas primero
        .forEach(([nombre, stats]) => {
            const c = _colorBySeverity(stats.criticos, stats.skus);
            html += `
                <div style="background:${c.bg}; border:1px solid ${c.border}; border-radius:12px; padding:1rem; transition:box-shadow 0.2s;">
                    <div style="font-weight:800; color:#1e293b; font-size:0.88rem; margin-bottom:6px;
                               white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
                         title="${nombre}">${nombre}</div>
                    <div style="font-size:0.73rem; color:#64748b;">${stats.skus} SKUs &bull; ${Math.round(stats.stockTotal).toLocaleString('es-CL')} unid.</div>
                    <div style="margin-top:8px; display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.68rem; background:${c.border}; color:${c.text};
                                     padding:2px 8px; border-radius:100px; font-weight:700;">${c.label}</span>
                        ${stats.criticos > 0 ? `<span style="font-size:0.68rem; color:#dc2626; font-weight:700;">⚠️ ${stats.criticos}</span>` : ''}
                    </div>
                </div>
            `;
        });

    html += `</div>`;
    tableEl.innerHTML = html;

    // Actualizar contadores del overlay (Saludables / En Riesgo)
    const RIESGO = ['VENCIDO', 'CRÍTICO', 'URGENTE'];
    const totalOk = data.filter(d => !RIESGO.includes((d.estado_alerta || '').toUpperCase())).length;
    const totalRisk = data.filter(d => RIESGO.includes((d.estado_alerta || '').toUpperCase())).length;
    if (document.getElementById('map-count-ok')) document.getElementById('map-count-ok').innerText = totalOk;
    if (document.getElementById('map-count-risk')) document.getElementById('map-count-risk').innerText = totalRisk;

    // Ajustar posición del overlay para que quede sobre la tabla (no sobre el mapa vacío)
    const overlay = document.getElementById('map-overlay-card');
    if (overlay) overlay.style.position = 'static';

    renderizarOptimizacionRuta(data, {});
}

// Función auxiliar para distancia Haversine (Gran Círculo)
function calcularDistanciaKM(lat1, lon1, lat2, lon2) {
    if (lat1 === lat2 && lon1 === lon2) return 0;
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * inicializarMapa — Inicializa Leaflet y renderiza los marcadores.
 * Solo se llama cuando el dataset tiene coordenadas reales.
 *
 * El centro del mapa se calcula dinámicamente a partir del centroide de todos
 * los marcadores (promedio lat/lon), NO hay coordenadas hardcodeadas.
 */
function inicializarMapa(data) {
    const mapEl = document.getElementById('mainMap');
    const tableEl = document.getElementById('branch-table-view');
    if (!mapEl || typeof L === 'undefined') return;

    // Asegurar visibilidad correcta: mapa visible, tabla oculta
    mapEl.style.display = 'block';
    mapEl.style.height = '100%';
    if (tableEl) tableEl.style.display = 'none';
    // Restaurar altura fija del wrapper (fue modificada en modo tabla)
    const wrapper = mapEl.closest('.map-wrapper');
    if (wrapper) wrapper.classList.remove('no-geo-mode');


    // Restaurar overlay como absolute (estaba static en modo tabla)
    const overlay = document.getElementById('map-overlay-card');
    if (overlay) overlay.style.position = 'absolute';

    // Filtrar solo ítems con coordenadas reales (evitar (0,0) que son nulos disfrazados)
    const geoItems = data.filter(i => {
        const lat = parseFloat(i.latitud);
        const lon = parseFloat(i.longitud);
        return !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0;
    });

    if (geoItems.length === 0) return; // Salvaguarda: no debería llegar aqui

    // Centroide dinámico calculado sobre los datos reales (sin hardcodes)
    const avgLat = geoItems.reduce((s, i) => s + parseFloat(i.latitud), 0) / geoItems.length;
    const avgLon = geoItems.reduce((s, i) => s + parseFloat(i.longitud), 0) / geoItems.length;

    if (!window.mapInstance) {
        window.mapInstance = L.map('mainMap').setView([avgLat, avgLon], 12);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO'
        }).addTo(window.mapInstance);
        window.markersLayer = L.layerGroup().addTo(window.mapInstance);
    } else {
        window.mapInstance.setView([avgLat, avgLon], 12);
    }

    if (window.markersLayer) window.markersLayer.clearLayers();

    let countOk = 0;
    let countRisk = 0;
    const branches = {}; // { nombre_ubicacion: { lat, lon } } para calcular distancias

    // Paleta de colores por estado de alerta (sin texto de negocio hardcodeado)
    const colorByAlerta = (estado) => {
        const e = (estado || '').toUpperCase();
        if (e === 'VENCIDO' || e === 'CRÍTICO') return '#ef4444';
        if (e === 'URGENTE') return '#f97316';
        if (e === 'PREVENTIVO') return '#f59e0b';
        return '#10b981'; // NORMAL o cualquier otro estado
    };

    geoItems.forEach(item => {
        const lat = parseFloat(item.latitud);
        const lon = parseFloat(item.longitud);
        const bName = item.nombre_ubicacion || 'Sin nombre';
        const color = colorByAlerta(item.estado_alerta);
        const esRiesgo = ['VENCIDO', 'CRÍTICO', 'URGENTE'].includes((item.estado_alerta || '').toUpperCase());

        if (!branches[bName]) branches[bName] = { lat, lon };
        if (esRiesgo) countRisk++; else countOk++;

        L.circleMarker([lat, lon], {
            radius: 8, fillColor: color, color: '#fff',
            weight: 2, opacity: 1, fillOpacity: 0.9
        }).addTo(window.markersLayer)
            .bindPopup(`
            <div style="font-family:'Inter',sans-serif;">
                <strong style="color:#1e293b;">${bName}</strong><br>
                <span style="color:#64748b; font-size:0.85rem;">${item.nombre_producto || ''}</span><br>
                <div style="margin-top:5px; padding-top:5px; border-top:1px solid #eee;">
                    Stock: <b>${item.cantidad_stock ?? '—'}</b><br>
                    Estado: <b style="color:${color}">${item.estado_alerta || 'Normal'}</b>
                </div>
            </div>
          `);
    });

    if (document.getElementById('map-count-ok')) document.getElementById('map-count-ok').innerText = countOk;
    if (document.getElementById('map-count-risk')) document.getElementById('map-count-risk').innerText = countRisk;

    // ── Poblar lista de sucursales en el overlay ──────────────────────────────
    const branchListEl = document.getElementById('map-branch-list');
    if (branchListEl && Object.keys(branches).length > 0) {
        // Determinar si cada sucursal tiene items en riesgo
        const riskByBranch = {};
        data.forEach(item => {
            const loc = item.nombre_ubicacion || '';
            const esRiesgo = ['VENCIDO', 'CRÍTICO', 'URGENTE'].includes((item.estado_alerta || '').toUpperCase());
            if (!riskByBranch[loc]) riskByBranch[loc] = false;
            if (esRiesgo) riskByBranch[loc] = true;
        });

        branchListEl.innerHTML = Object.keys(branches).map(nombre => {
            const enRiesgo = riskByBranch[nombre] ?? false;
            const dotColor = enRiesgo ? '#ef4444' : '#10b981';
            return `
                <div style="display:flex; align-items:center; gap:5px;">
                    <span style="width:7px; height:7px; border-radius:50%; background:${dotColor}; flex-shrink:0;"></span>
                    <span style="font-size:0.65rem; color:#475569; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${nombre}</span>
                </div>
            `;
        }).join('');
    }

    renderizarOptimizacionRuta(data, branches);

}

/**
 * renderizarOptimizacionRuta — Orquesta la optimización de redistribución.
 *
 * PIPELINE:
 *   1. Llama a GET /api/logistics/optimize (backend Python)
 *   2. El backend corre el algoritmo greedy (optimization.py) → calcula traslados
 *   3. El backend pasa los resultados a la IA → interpretación en lenguaje natural
 *   4. Este función renderiza las tarjetas de traslados + el texto de la IA
 *
 * La IA NO calcula: solo interpreta los números ya calculados por el algoritmo.
 *
 * @param {Array}  data     - Lista completa de ítems (solo para fallback local)
 * @param {Object} branches - Mapa { nombre: { lat, lon } } (no se usa, el backend lo maneja)
 */
async function renderizarOptimizacionRuta(data, branches) {
    const listEl = document.getElementById('optimizedRouteList');
    const insightEl = document.querySelector('.route-optimization-panel .ia-insight-text');
    if (!listEl) return;

    // Spinner de carga
    listEl.innerHTML = `
        <div style="text-align:center; padding:2rem; color:#94a3b8;">
            <div style="font-size:1.5rem; margin-bottom:0.5rem;">⚙️</div>
            <p style="margin:0; font-size:0.82rem; font-weight:600;">Calculando redistribución óptima…</p>
            <p style="margin:0.25rem 0 0 0; font-size:0.72rem;">Algoritmo greedy + análisis de IA</p>
        </div>
    `;
    if (insightEl) insightEl.textContent = 'Analizando la red de sucursales…';

    try {
        const resp = await fetch(`${API_URL}/api/logistics/optimize`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const resultado = await resp.json();

        const traslados = resultado.traslados || [];
        const metricas = resultado.metricas || {};
        const interpretacion = resultado.interpretacion_ia || '';

        // ── Renderizar tarjetas de traslados ──────────────────────────────────
        if (traslados.length === 0) {
            // Sin traslados posibles: mostrar motivo amigable
            listEl.innerHTML = `
                <div style="text-align:center; padding:1.5rem; background:#fff7ed; border:1px solid #fed7aa; border-radius:12px;">
                    <span style="font-size:1.5rem;">⚠️</span>
                    <p style="margin:0.5rem 0 0 0; font-size:0.85rem; color:#9a3412; font-weight:600;">
                        Sin traslados disponibles
                    </p>
                    <p style="margin:0.25rem 0 0 0; font-size:0.72rem; color:#c2410c;">
                        ${metricas.total_sucursales <= 1
                    ? 'Solo hay una ubicación. Los traslados requieren al menos dos sucursales.'
                    : 'No se detectaron excedentes aprovechables. Se recomienda reposición desde proveedor.'}
                    </p>
                </div>
            `;
        } else {
            // Renderizar cada traslado como tarjeta
            const _colorEstado = (e) => {
                const s = (e || '').toUpperCase();
                if (s === 'VENCIDO' || s === 'CRÍTICO') return '#dc2626';
                if (s === 'URGENTE') return '#d97706';
                return '#059669';
            };

            listEl.innerHTML = traslados.map(t => {
                const distTxt = t.distancia_km != null ? `${t.distancia_km} km` : 'Sin coordenadas';
                const estColor = _colorEstado(t.estado_dest);
                return `
                    <div style="display:flex; flex-direction:column; gap:4px; padding:0.85rem;
                                background:#f8fafc; border-radius:12px; border:1px solid #e2e8f0;
                                margin-bottom:0.5rem; transition:box-shadow 0.2s;"
                         onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'"
                         onmouseout="this.style.boxShadow='none'">
                        <!-- Producto -->
                        <div style="font-size:0.8rem; font-weight:800; color:#1e293b; margin-bottom:2px;">
                            📦 ${t.producto}
                        </div>
                        <!-- Ruta sucursales -->
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <span style="flex:1; font-size:0.72rem; font-weight:700; color:#059669;
                                         background:#f0fdf4; padding:2px 8px; border-radius:6px; text-align:center;">
                                ${t.desde}
                            </span>
                            <span style="color:#6366f1; font-weight:800; font-size:1rem;">→</span>
                            <span style="flex:1; font-size:0.72rem; font-weight:700; color:${estColor};
                                         background:#fef2f2; padding:2px 8px; border-radius:6px; text-align:center;">
                                ${t.hacia}
                            </span>
                        </div>
                        <!-- Métricas -->
                        <div style="display:flex; gap:0.4rem; align-items:center; margin-top:2px;">
                            <span style="background:#e0e7ff; color:#3730a3; font-size:0.65rem;
                                         font-weight:700; padding:2px 8px; border-radius:6px;">
                                ${t.unidades} unid.
                            </span>
                            <span style="background:#f1f5f9; color:#64748b; font-size:0.65rem;
                                         padding:2px 8px; border-radius:6px;">
                                📍 ${distTxt}
                            </span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // ── Renderizar interpretación IA ──────────────────────────────────────
        if (insightEl) {
            // Convertir Markdown a HTML:
            // ### Titulo → <h4>, ## Titulo → <h4>, **bold** → <strong>, _italic_ → <em>, \n → <br>
            const htmlTexto = interpretacion
                .replace(/^###\s+(.+)$/gm, '<h4 style="margin:0.6rem 0 0.2rem 0; font-size:0.78rem; color:#4f46e5; font-weight:800;">$1</h4>')
                .replace(/^##\s+(.+)$/gm, '<h4 style="margin:0.6rem 0 0.2rem 0; font-size:0.8rem; color:#4f46e5; font-weight:800;">$1</h4>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/_(.+?)_/g, '<em>$1</em>')
                .replace(/^→\s*/gm, '→ ')
                .replace(/\n/g, '<br>');
            insightEl.innerHTML = htmlTexto;
        }

        // ── Actualizar lista de sucursales en overlay (fallback si no hay geo) ─
        const branchListFallback = document.getElementById('map-branch-list');
        if (branchListFallback && branchListFallback.children.length === 0) {
            // El mapa con geo ya lo llenó; solo usamos el endpoint si está vacío
            const nombres = metricas.sucursales_nombres || Object.keys(resultado.sucursales || {});
            if (nombres.length > 0) {
                const sucursalesData = resultado.sucursales || {};
                branchListFallback.innerHTML = nombres.map(nombre => {
                    const rs = sucursalesData[nombre] || {};
                    const enRiesgo = (rs.criticos || 0) > 0;
                    const dotColor = enRiesgo ? '#ef4444' : '#10b981';
                    return `
                        <div style="display:flex; align-items:center; gap:5px;">
                            <span style="width:7px; height:7px; border-radius:50%; background:${dotColor}; flex-shrink:0;"></span>
                            <span style="font-size:0.65rem; color:#475569; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${nombre}</span>
                        </div>
                    `;
                }).join('');
            }
        }

    } catch (err) {
        console.error('Error en optimización de ruta:', err);
        listEl.innerHTML = `
            <div style="text-align:center; padding:1.5rem; background:#fef2f2; border-radius:12px; border:1px solid #fecaca;">
                <p style="margin:0; font-size:0.82rem; color:#dc2626; font-weight:600;">
                    Error al calcular optimización
                </p>
                <p style="margin:0.25rem 0 0 0; font-size:0.72rem; color:#ef4444;">${err.message}</p>
            </div>
        `;
        if (insightEl) insightEl.textContent = 'No se pudo conectar con el motor de optimización.';
    }
}






// ---- SENSIBILIDAD ----

function inicializarSensibilidad() {
    const searchInput = document.getElementById("searchProductSim");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            dispararBusquedaSimulador();
        });
    }
}

function dispararBusquedaSimulador() {
    const searchVal = document.getElementById("searchProductSim").value.toLowerCase();
    const list = document.getElementById("productSimList");

    if (searchVal.length < 2) {
        list.innerHTML = "";
        return;
    }

    const filtered = DATOS_CRUDOS.filter(item => {
        const nombre = (item.nombre_producto || "").toLowerCase();
        return nombre.includes(searchVal);
    }).slice(0, 10);

    list.innerHTML = filtered.map(item => {
        const n = item.nombre_producto || "Sin Nombre";
        const sid = item.id_producto;
        const sActual = item.cantidad_stock || 0;
        const pVenta = item.precio_unitario || 0;

        return `
          <li class="file-item" style="padding: 0.75rem; border-bottom: 1px solid #e5e7eb; cursor: pointer;" onclick="cargarSimulacionProducto('${sid}', '${n}')">
              <div style="font-weight: 600; color: #1f2937;">${n}</div>
              <div style="font-size: 0.8rem; color: #6b7280;">Stock: ${sActual} | Precio: $${pVenta}</div>
          </li>
        `;
    }).join("");
}

window.dispararBusquedaSimulador = dispararBusquedaSimulador;

window.togglePlannerMetrics = function () {
    const el = document.getElementById('planner-metrics-content');
    const arrow = document.getElementById('planner-metrics-arrow');
    if (el) {
        const isHidden = el.style.display === 'none' || el.style.display === '';
        el.style.display = isHidden ? 'grid' : 'none';
        if (arrow) arrow.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    }
};
// Keep old name as alias for backward compatibility
window.toggleCopilotMetrics = window.togglePlannerMetrics;

window.optimizarInversionMinima = function () {
    const advice = document.getElementById('quick-action-advice');
    if (!advice) return;

    // Obtener productos críticos del forecast
    const enRiesgo = (window.LAST_FORECAST_DATA && window.LAST_FORECAST_DATA.alertas_quiebre) || [];
    const sorted = [...enRiesgo].sort((a, b) => (a.dias_quiebre || 999) - (b.dias_quiebre || 999));
    const top60pct = sorted.slice(0, Math.ceil(sorted.length * 0.6));
    const totalMin = top60pct.reduce((s, i) => s + ((i.proyeccion_mensual || 0) * (i.costo_unitario || i.precio_unitario || 0)), 0);

    // Generar lista de productos sugeridos
    const listHtml = top60pct.length > 0
        ? top60pct.map(i => {
            const qty = Math.ceil(i.proyeccion_mensual || 0);
            const costo = (i.costo_unitario || i.precio_unitario || 0);
            const subtotal = qty * costo;
            return `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #ede9fe; font-size:0.82rem;">
                <div>
                    <span style="font-weight:700; color:#1e293b;">${i.nombre_producto}</span><br>
                    <span style="color:#94a3b8;">${qty} unid. &times; $${Math.round(costo).toLocaleString('es-CL')}</span>
                </div>
                <span style="font-weight:800; color:#5b21b6; white-space:nowrap; margin-left:12px;">$${Math.round(subtotal).toLocaleString('es-CL')}</span>
            </div>`;
        }).join('')
        : '<p style="color:#94a3b8; text-align:center; padding:1rem 0;">No hay datos de forecast disponibles aún.</p>';

    // Actualizar el contenido del panel
    const amountEl = document.getElementById('quick-action-amount');
    if (amountEl) amountEl.textContent = `$${Math.round(totalMin).toLocaleString('es-CL')} CLP`;

    const prodListEl = document.getElementById('quick-action-product-list');
    if (prodListEl) prodListEl.innerHTML = listHtml;

    advice.style.display = 'block';
    advice.scrollIntoView({ behavior: 'smooth', block: 'center' });
};


window.cargarDashboardForecastingGeneral = async function (mes = null, anio = null) {
    try {
        const token = localStorage.getItem("token");
        let url = `${API_URL}/api/forecast/summary`;
        const params = [];
        if (mes) params.push(`mes=${mes}`);
        if (anio) params.push(`anio=${anio}`);
        if (window._analisisActivo) params.push(`fuente=${encodeURIComponent(window._analisisActivo)}`);
        if (params.length > 0) url += `?${params.join("&")}`;

        const res = await fetch(url, {
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();
            window.LAST_FORECAST_DATA = data;
        } else {
            console.error(`Error de API: ${res.status} ${res.statusText}`);
            if (res.status === 401) {
                localStorage.removeItem("token");
                window.location.href = "index.html";
                return;
            }
            showToast(`Error al cargar datos: ${res.status}`, "error");
            document.getElementById("copilot-days-to-stockout").innerText = `Error de conexión (${res.status})`;
            return;
        }

        const data = window.LAST_FORECAST_DATA;

        // 1. CALCULO DE VARIABLES PARA EL ASISTENTE DE PLANIFICACIÓN
        const enRiesgo = data.alertas_quiebre || [];
        let totalInversionNeeded = 0;
        let minDays = 999;

        enRiesgo.forEach(i => {
            // Solo invertimos en lo que falta para cubrir la proyección de 30 días
            const stockActual = i.cantidad_stock || 0;
            const proyMensual = i.proyeccion_mensual || 0;
            const faltante = Math.max(0, proyMensual - stockActual);

            const costo = faltante * (i.costo_unitario || i.precio_unitario || 800);
            totalInversionNeeded += costo;

            if (i.dias_quiebre < minDays && i.dias_quiebre >= 0) minDays = Math.round(i.dias_quiebre);
        });

        if (minDays === 999) minDays = 0;

        // Rango de fechas del análisis: desde hoy - 30 días hasta hoy
        const hoyDate = window.HOY ? new Date(window.HOY) : new Date();
        const inicioDate = new Date(hoyDate);
        inicioDate.setDate(inicioDate.getDate() - 30);
        const fmt = (d) => d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const fromEl = document.getElementById('planner-date-from');
        const toEl = document.getElementById('planner-date-to');
        if (fromEl) fromEl.textContent = fmt(inicioDate);
        if (toEl) toEl.textContent = fmt(hoyDate);

        // Panel de decisión central
        const daysEl = document.getElementById("planner-days-to-stockout");
        const investEl = document.getElementById("planner-investment");
        const statusBadge = document.getElementById("planner-status-badge");
        const mainCard = document.getElementById("planner-main-card");

        if (daysEl) {
            if (minDays === 0) {
                daysEl.innerText = "Tienes productos con quiebre inminente (0 días)";
            } else {
                daysEl.innerText = `Te quedarás sin stock en ${minDays} días (escenario base)`;
            }
        }
        if (investEl) investEl.innerText = formatCLP(totalInversionNeeded);
        if (statusBadge) {
            if (minDays <= 7) {
                statusBadge.innerHTML = `<span style="display:flex; align-items:center; justify-content:center; width:12px; height:12px; border-radius:50%; background:rgba(255,255,255,0.4); border:1px solid rgba(255,255,255,0.6);"></span> Riesgo de Quiebre: ALTO`;
                statusBadge.style.background = "#ef4444";
                if (mainCard) mainCard.style.background = "linear-gradient(135deg, #ffffff 0%, #fff5f5 100%)";
                if (mainCard) mainCard.style.borderColor = "#fee2e2";
            } else if (minDays <= 15) {
                statusBadge.innerHTML = `<span style="display:flex; align-items:center; justify-content:center; width:12px; height:12px; border-radius:50%; background:rgba(255,255,255,0.4); border:1px solid rgba(255,255,255,0.6);"></span> Riesgo de Quiebre: MEDIO`;
                statusBadge.style.background = "#f59e0b";
                if (mainCard) mainCard.style.background = "linear-gradient(135deg, #ffffff 0%, #fffbeb 100%)";
                if (mainCard) mainCard.style.borderColor = "#fef3c7";
            } else {
                statusBadge.innerHTML = `<span style="display:flex; align-items:center; justify-content:center; width:12px; height:12px; border-radius:50%; background:rgba(255,255,255,0.4); border:1px solid rgba(255,255,255,0.6);"></span> Riesgo de Quiebre: BAJO`;
                statusBadge.style.background = "#3b82f6";
                if (mainCard) mainCard.style.background = "linear-gradient(135deg, #ffffff 0%, #f0f9ff 100%)";
                if (mainCard) mainCard.style.borderColor = "#dbeafe";
            }
        }

        // Escenarios
        // Alta demanda: +25% demanda -> -20% tiempo
        // Baja demanda: -25% demanda -> +33% tiempo
        const highDays = minDays === 0 ? 0 : Math.max(1, Math.round(minDays * 0.7));
        const lowDays = minDays === 0 ? 0 : Math.round(minDays * 1.5);

        const diasText = (d) => d === 0 ? "Quiebre Inminente" : `${d} días`;

        document.getElementById("planner-scenario-high-days").innerText = diasText(highDays);
        document.getElementById("planner-scenario-high-impact").innerText = `${formatCLP(totalInversionNeeded * 1.25)}`;

        document.getElementById("planner-scenario-base-days").innerText = diasText(minDays);
        document.getElementById("planner-scenario-base-impact").innerText = `${formatCLP(totalInversionNeeded)}`;

        document.getElementById("planner-scenario-low-days").innerText = diasText(lowDays);
        document.getElementById("planner-scenario-low-impact").innerText = `${formatCLP(totalInversionNeeded * 0.75)}`;

        // Listas de prioridad
        const list1 = document.getElementById("planner-priority-list-1");
        const list2 = document.getElementById("planner-priority-list-2");
        const list3 = document.getElementById("planner-priority-list-3");
        const listReorden = document.getElementById("planner-priority-list-reorden");

        // P0: Quiebres Actuales (Reposición Inmediata)
        const reordenItems = enRiesgo.filter(i => (i.stock_neto || 0) <= 0).sort((a, b) => (a.stock_neto || 0) - (b.stock_neto || 0)).slice(0, 3);
        if (listReorden) {
            listReorden.innerHTML = reordenItems.length > 0 ? reordenItems.map(i => `
                    <div class="p-item" style="border-left: 3px solid #6366f1;">
                        <span>${i.nombre_producto}</span>
                        <span style="color:#ef4444;">Neto: ${Math.round(i.stock_neto || 0)}</span>
                    </div>
                `).join("") : `<div style="color:#94a3b8; font-size:0.75rem; text-align:center; padding:1.5rem;">Sin quiebres pendientes.</div>`;
        }

        // P1: Sin proveedor alternativo (Crítico)
        const p1Items = enRiesgo.filter(i => !i.proveedor || i.proveedor === "Sin Proveedor" || i.proveedor === "Desconocido").slice(0, 3);
        if (list1) {
            list1.innerHTML = p1Items.length > 0 ? p1Items.map(i => `
                    <div class="p-item">
                        <span>${i.nombre_producto}</span>
                        <span style="color:#ef4444;">${formatCLP((i.proyeccion_mensual || 0) * (i.costo_unitario || 0))}</span>
                    </div>
                `).join("") : `<div style="color:#94a3b8; font-size:0.75rem; text-align:center; padding:1.5rem;">Todo bajo control.</div>`;
        }

        // P2: Alta rotación
        const p2Items = [...enRiesgo].sort((a, b) => (b.proyeccion_mensual || 0) - (a.proyeccion_mensual || 0)).slice(0, 3);
        if (list2) {
            list2.innerHTML = p2Items.length > 0 ? p2Items.map(i => `
                    <div class="p-item">
                        <span>${i.nombre_producto}</span>
                        <span style="color:#f59e0b;">${Math.round(i.proyeccion_mensual)} unid.</span>
                    </div>
                `).join("") : `<div style="color:#94a3b8; font-size:0.75rem; text-align:center; padding:1.5rem;">Carga equilibrada.</div>`;
        }

        // P3: Preventivo
        const p3Items = enRiesgo.filter(i => i.dias_quiebre > 15).sort((a, b) => a.dias_quiebre - b.dias_quiebre).slice(0, 3);
        if (list3) {
            list3.innerHTML = p3Items.length > 0 ? p3Items.map(i => `
                    <div class="p-item">
                        <span>${i.nombre_producto}</span>
                        <span style="color:#3b82f6;">${Math.round(i.dias_quiebre)} días</span>
                    </div>
                `).join("") : `<div style="color:#94a3b8; font-size:0.75rem; text-align:center; padding:1.5rem;">Monitoreo preventivo OK.</div>`;
        }

        // PANORAMA DE NEGOCIO: Indicadores Clave
        const valDemanda = document.getElementById("panorama-val-demanda");
        const valSalud = document.getElementById("panorama-val-salud");
        const valPrecision = document.getElementById("panorama-val-precision");
        const valCapital = document.getElementById("panorama-val-capital");
        const iaReasoning = document.getElementById("panorama-asistente-reasoning");

        if (valDemanda) valDemanda.innerText = `${Math.round(data.demanda_total_estimada || 0).toLocaleString('es-CL')}`;
        if (valSalud) {
            const salud = data.salud_stock || 0;
            valSalud.innerText = `${salud}%`;
            valSalud.style.color = salud < 50 ? '#ef4444' : (salud < 80 ? '#f59e0b' : '#22c55e');
        }
        if (valPrecision) valPrecision.innerText = `${data.precision_forecast || 85}%`;
        if (valCapital) valCapital.innerText = formatCLP(data.total_valor_inventario || 0);
        if (iaReasoning) iaReasoning.innerHTML = data.razonamiento || "Analizando comportamiento de demanda...";

        // Métricas de soporte del sistema (Legado / Técnico)
        const mConf = document.getElementById("planner-metric-confianza");
        const mCap = document.getElementById("planner-metric-capital");
        const mElas = document.getElementById("planner-metric-elasticidad");
        const mRot = document.getElementById("planner-metric-rotacion");

        if (mConf) mConf.innerText = `${data.precision_forecast || 85}%`;
        if (mCap) mCap.innerText = formatCLP(data.total_valor_inventario || 0);
        if (mElas) mElas.innerText = "1.2 (Promedio)";
        if (mRot) mRot.innerText = `${Math.round(data.demanda_total_estimada || 0).toLocaleString('es-CL')} unid.`;

        // Quick Action
        document.getElementById("quick-action-amount").innerText = formatCLP(totalInversionNeeded * 0.6);

        // Gráfico
        renderizarForecastingIA(data, false, window.currentForecastFilter || 'general');

    } catch (err) {
        console.error("Error en dashboard de forecasting:", err);
    }
};


window.filtrarGraficoCategorias = function (tipo, btnEl) {
    if (btnEl) {
        const btnGen = document.getElementById('btnFilterGeneral');
        const btnCri = document.getElementById('btnFilterCriticos');
        if (btnGen) btnGen.style = "background:transparent; border:none; padding:4px 12px; border-radius:6px; font-size:0.75rem; font-weight:700; color:#64748b; cursor:pointer;";
        if (btnCri) btnCri.style = "background:transparent; border:none; padding:4px 12px; border-radius:6px; font-size:0.75rem; font-weight:600; color:#64748b; cursor:pointer;";
        btnEl.style = "background:white; border:none; padding:4px 12px; border-radius:6px; font-size:0.75rem; font-weight:800; color:#1e293b; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.05);";
    }

    window.currentForecastFilter = tipo;
    if (window.lastGeneralForecastData) {
        renderizarForecastingIA(window.lastGeneralForecastData, false, tipo);
    }
};

window.filtrarPorFecha = function (val) {
    showToast('Sincronizando escenario al ' + val + '...', 'info');
    const [year, month] = val.split('-');

    window._FILTRO_MES = parseInt(month);
    window._FILTRO_ANIO = parseInt(year);

    // Recargar datos de forecast
    window.cargarDashboardForecastingGeneral(window._FILTRO_MES, window._FILTRO_ANIO);

    // Recargar recomendaciones de IA para ese periodo
    window.cargarRecomendacionesIA(window._FILTRO_MES, window._FILTRO_ANIO);

    // Actualizar indicador visual global
    window.actualizarInterfazLocal();
}

window.actualizarContadorOrdenHeader = function () {
    const badge = document.getElementById("orderCountBadge");
    if (badge && window.ITEMS_ORDEN) {
        badge.textContent = window.ITEMS_ORDEN.size;
        badge.style.display = window.ITEMS_ORDEN.size > 0 ? 'flex' : 'none';
    }
}

window.generarYDescargarOrdenCSV = function () {
    window.ordenGenerada = true;

    if (!window.ITEMS_ORDEN || window.ITEMS_ORDEN.size === 0) {
        showToast('No hay productos en tu orden actual. Agrega algunos desde los escenarios de demanda.', 'error');
        if (typeof window.abrirCajonOrden === 'function') window.abrirCajonOrden();
        return;
    }

    let csv = "Producto,Cantidad a Reponer,Motivo/Escenario,Fecha Agregado\n";
    Array.from(window.ITEMS_ORDEN.values()).forEach(a => {
        csv += `"${a.producto}",${Math.round(a.cantidad)},"${a.escenario}","${a.fecha}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "Orden_Proveedores_Automatica.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

window.cargarSimulacionProducto = async function (productoId, nombreProducto) {
    const list = document.getElementById("productSimList");
    if (list) list.innerHTML = "";
    document.getElementById("searchProductSim").value = nombreProducto;

    const dashboard = document.getElementById("forecastingDashboard");
    const sensitivityArea = document.getElementById("priceSensitivityArea");
    const forecastProductNameEl = document.getElementById("forecastProductName");
    const forecastReasoningEl = document.getElementById("forecastReasoning");
    const forecastGeneralShortlist = document.getElementById("forecastGeneralShortlist");

    if (forecastGeneralShortlist) forecastGeneralShortlist.innerHTML = "<p style='font-size:0.85rem; color:#64748b; padding:10px;'>Viendo vista individual.</p>"; // Clear general shortlist
    if (forecastProductNameEl) forecastProductNameEl.innerHTML = `Análisis de Previsión: ${nombreProducto} <button onclick="cargarDashboardForecastingGeneral()" style="margin-left: 10px; padding: 4px 10px; font-size: 0.75rem; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer; color: #334155; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">⬅ Volver al Resumen</button>`;
    if (forecastReasoningEl) forecastReasoningEl.innerHTML = `<div style="display:flex; align-items:center; gap:0.5rem;"><div class="loader" style="width:15px; height:15px; border-width:2px;"></div><span>IA está analizando el historial y alertas vigentes...</span></div>`;
    if (dashboard) dashboard.style.display = "block";
    if (sensitivityArea) sensitivityArea.style.display = "none";

    // Buscar si el producto tiene una alerta activa en el dashboard (coherencia)
    const alertItem = DATOS_CRUDOS.find(d => d.id_producto === productoId);
    let alertBadge = "";
    if (alertItem && alertItem.estado_alerta && alertItem.estado_alerta !== "NORMAL") {
        const est = alertItem.estado_alerta;
        const col = est === "VENCIDO" || est === "CRÍTICO" ? "#ef4444" : "#f97316";
        alertBadge = `<div style="margin-top:0.5rem; display:inline-flex; align-items:center; gap:6px; background:${col}10; color:${col}; padding:4px 10px; border-radius:6px; font-size:0.75rem; font-weight:800; border:1px solid ${col}30;">ESTADO ACTUAL: ${est}</div>`;
    }

    if (forecastProductNameEl && alertBadge) {
        forecastProductNameEl.insertAdjacentHTML('afterend', alertBadge);
    }

    try {
        const token = localStorage.getItem("token");
        const fuenteParam = window._analisisActivo ? `?fuente=${encodeURIComponent(window._analisisActivo)}` : '';
        const [resSens, resForecast] = await Promise.all([
            fetch(`${API_URL}/api/sensitivity/${encodeURIComponent(productoId)}${fuenteParam}`, {
                headers: { "Authorization": `Bearer ${token}` }
            }),
            fetch(`${API_URL}/api/forecast/${encodeURIComponent(productoId)}${fuenteParam}`, {
                headers: { "Authorization": `Bearer ${token}` }
            })
        ]);

        if (resSens.ok) {
            const dataSens = await resSens.json();
            dibujarEscenariosSensibilidad(dataSens);
            if (sensitivityArea) sensitivityArea.style.display = "block";
        }

        if (resForecast.ok) {
            const dataForecast = await resForecast.json();
            renderizarForecastingIA(dataForecast, true); // true = modo individual
        }
    } catch (err) {
        console.error("Error en simulación:", err);
        showToast("Error al procesar la predicción", "error");
    }
};

function formatCLP(value) {
    return new Intl.NumberFormat('es-CL', {
        style: 'decimal',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value) + " CLP";
}

function dibujarEscenariosSensibilidad(matriz) {
    const grid = document.getElementById("sensitivityGrid");
    if (!grid) return;

    if (!matriz || matriz.length === 0) {
        grid.innerHTML = `<div class="empty-state-sensitivity"><p>Sin datos para este producto.</p></div>`;
        return;
    }

    // Dibujar matriz de sensibilidad (HU-03)
    let html = matriz.map(scen => `
        <div class="scen-card ${scen.is_base ? 'scen-base' : ''}">
            <div class="scen-header">
                <span class="scen-dot dot-${scen.color}"></span>
                <span>${scen.escenario} (${scen.porcentaje})</span>
                ${scen.is_base ? '<span>(✓)</span>' : ''}
            </div>
            <div class="scen-value val-${scen.color}">${formatCLP(scen.valor_total)}</div>
            <div class="scen-details">
                <div>Recuperación: ${formatCLP(scen.recuperacion).replace(" CLP", "")}</div>
                <div>+ Crédito: ${formatCLP(scen.credito).replace(" CLP", "")}</div>
            </div>
        </div>
    `).join("");

    grid.innerHTML = html;

    // --- NUEVA LÓGICA DE GRÁFICO ---
    const ctx = document.getElementById('sensitivityChart');
    if (!ctx) return;

    if (window.sensitivityChart) {
        window.sensitivityChart.destroy();
    }

    const labels = matriz.map(m => m.escenario);
    const dataValues = matriz.map(m => m.valor_total);
    const backgroundColors = matriz.map(m => {
        if (m.color === 'blue') return 'rgba(59, 130, 246, 0.6)';
        if (m.color === 'purple') return 'rgba(139, 92, 246, 0.8)';
        if (m.color === 'indigo') return 'rgba(99, 102, 241, 0.6)';
        return 'rgba(203, 213, 225, 0.5)';
    });
    const borderColors = matriz.map(m => {
        if (m.color === 'blue') return '#2563eb';
        if (m.color === 'purple') return '#7c3aed';
        if (m.color === 'indigo') return '#4f46e5';
        return '#94a3b8';
    });

    window.sensitivityChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ingreso Estimado (CLP)',
                data: dataValues,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 2,
                borderRadius: 8,
                barThickness: 60
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return 'Valor Total: ' + formatCLP(context.raw);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function (value) {
                            return formatCLP(value).replace(' CLP', '');
                        },
                        font: { size: 10 }
                    }
                },
                x: {
                    ticks: { font: { weight: 'bold', size: 11 } }
                }
            }
        }
    });
}

function renderizarForecastingIA(data, esIndividual = false, filtro = 'general') {
    try {
        const p = esIndividual ? data.prediccion : data;

        // Reset old elements safely
        if (esIndividual) {
            const valEl = document.getElementById("forecastValue");
            if (valEl) {
                // Si es individual, mostramos la proyeccion del producto, no el total
                valEl.innerText = Math.round(p?.proyeccion_mensual || 0).toLocaleString('es-CL');
            }

            const reqEl = document.getElementById("forecastStockSuggest");
            if (reqEl) reqEl.innerText = formatCLP(p?.valor_stock || 0);

            const seasEl = document.getElementById("forecastSeasonality");
            if (seasEl) seasEl.innerText = p?.punto_reorden ? `Reorden: ${p.punto_reorden}` : "Óptimo";
        }

        const container = document.getElementById('forecastVisualContainer');
        const btnReponer = document.getElementById("btnCopilotReposition");
        if (!container) return;

        // HU-COHERENCIA: Restaurar estado del botón principal de reponer si ya hay alertas procesadas
        if (btnReponer && window.ITEMS_ORDEN) {
            const yaReponiendo = Array.from(window.ITEMS_ORDEN.values())
                .some(it => it.escenario === "Sugerencia del Sistema: Evitar Quiebre");
            if (yaReponiendo) {
                btnReponer.innerHTML = '✅ Reposición Programada';
                btnReponer.disabled = true;
                btnReponer.style.opacity = '0.7';
                btnReponer.style.cursor = 'default';
            } else {
                btnReponer.innerHTML = '🛒 Iniciar Reposición';
                btnReponer.disabled = false;
                btnReponer.style.opacity = '1';
                btnReponer.style.cursor = 'pointer';
            }
        }

        let stockActual = 0;
        let ventaEsperada = 0;
        let nombre = "Total de Mercadería";

        if (!esIndividual) {
            stockActual = Number(data?.total_inventario_general) || 0;
            ventaEsperada = Number(data?.demanda_total_estimada) || 0;

            if (filtro === 'criticos') {
                const alertas = data?.alertas_quiebre || [];
                // Si hay productos en riesgo, sumamos su stock y demanda promediada
                if (alertas.length > 0) {
                    stockActual = alertas.reduce((acc, curr) => acc + (Number(curr.stock_actual) || 0), 0);
                    ventaEsperada = alertas.reduce((acc, curr) => acc + (Number(curr.proyeccion_mensual) || 0), 0);
                } else {
                    // Fallback proporcional solo si no hay lista detallada (poco probable)
                    stockActual = Math.round(stockActual * 0.1);
                    ventaEsperada = Math.round(ventaEsperada * 0.1);
                }
                nombre = "Productos Críticos";
            }
        } else {
            nombre = p?.nombre_producto ? p.nombre_producto.substring(0, 30) + '...' : 'Producto';
            const hist = data?.historico || [];
            stockActual = hist.length > 0 ? Number(hist[hist.length - 1].unidades) : 0;
            ventaEsperada = Number(p?.proyeccion_mensual) || 0;
        }

        stockActual = Math.max(0, stockActual);
        ventaEsperada = Math.max(0, ventaEsperada);

        // Sensibilidad basada en el historial real si existe (volatilidad)
        let factorVarianza = 0.25;
        if (!esIndividual && data.historico_agregado && data.historico_agregado.length > 1) {
            // Un cálculo simple de volatilidad basado en el historial
            const vals = data.historico_agregado.map(h => h.unidades);
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
            const deviation = Math.sqrt(vals.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / vals.length);
            factorVarianza = Math.min(0.4, Math.max(0.15, (deviation / (mean || 1))));
        }

        const ventaAlta = Math.round(ventaEsperada * (1 + factorVarianza));
        const ventaBaja = Math.round(ventaEsperada * (1 - factorVarianza));

        const saldoNormal = stockActual - ventaEsperada;
        const saldoAlto = stockActual - ventaAlta;
        const saldoBajo = stockActual - ventaBaja;

        const formato = (num) => Math.round(num).toLocaleString('es-CL') + ' unid.';

        const generarFilaContexto = (titulo, ventas, saldo, esNormal = false) => {
            const esRiesgo = saldo < 0;
            const bgColor = esNormal ? '#f8fafc' : 'transparent';
            const border = esNormal ? 'border: 2px solid #8b5cf6;' : 'border: 1px solid #e2e8f0;';
            const statusColor = esRiesgo ? '#ef4444' : '#10b981';
            const statusText = esRiesgo ? `Faltarán ${formato(Math.abs(saldo))}` : `Sobrarán ${formato(saldo)}`;
            const icon = esRiesgo ? '⚠️' : '✅';

            // Botón de acción solicitado por el usuario para casos de riesgo
            const yaAgregado = window.ITEMS_ORDEN && window.ITEMS_ORDEN.has(nombre);
            // Escapar comillas simples para el onclick
            const nombreEscaped = nombre.replace(/'/g, "\\'");
            const statusEscaped = statusText.replace(/'/g, "\\'");

            const actionBtn = esRiesgo ? `
                <button onclick="window.agregarAlPedido('${nombreEscaped}', ${Math.abs(saldo)}, '${statusEscaped}', this)" 
                        ${yaAgregado ? 'disabled' : ''}
                        style="margin-top:8px; background:${yaAgregado ? '#6366f1' : statusColor}; color:white; border:none; padding:4px 12px; border-radius:6px; font-size:0.7rem; font-weight:700; cursor:pointer; display:block; width:100%; transition: all 0.2s;">
                    ${yaAgregado ? '✅ Agregado a la Orden' : '🛒 Agregar a mi orden'}
                </button>
            ` : '';

            return `
                <div style="background: ${bgColor}; ${border} border-radius: 10px; padding: 1rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
                    <div style="flex: 1;">
                        <h4 style="margin: 0 0 4px 0; color: #1e293b; font-size: 0.95rem; font-weight: 700;">${titulo}</h4>
                        <p style="margin: 0; color: #64748b; font-size: 0.8rem;">Se venderían aprox. <strong>${formato(ventas)}</strong></p>
                    </div>
                    <div style="text-align: right; background: ${statusColor}10; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid ${statusColor}40;">
                        <span style="display: block; font-size: 1.1rem; margin-bottom: 2px;">${icon}</span>
                        <strong style="color: ${statusColor}; font-size: 0.85rem;">${statusText}</strong>
                        ${actionBtn}
                    </div>
                </div>
            `;
        };

        const subinversion = ventaEsperada > 0 ? Math.round(((ventaEsperada - stockActual) / ventaEsperada) * 100) : 0;
        const insightText = subinversion > 0
            ? `<div style="display:flex; align-items:center; gap:6px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> <span>Falta <strong>un ${subinversion}% de inventario</strong> para cubrir la demanda proyectada del mes.</span></div>`
            : `<div style="display:flex; align-items:center; gap:6px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> <span>Tu inventario actual cubre el 100% de la demanda proyectada del mes.</span></div>`;


        container.innerHTML = `
            <div style="background: #f8fafc; padding: 1rem; border-radius: 12px; margin-bottom: 1.5rem; border: 1px solid #e2e8f0; display: flex; align-items: center; gap: 12px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                <div style="margin: 0; color: #1e293b; font-size: 0.95rem; font-weight: 600;">${insightText}</div>
            </div>
            
            <div style="height: 280px; width: 100%; margin-bottom: 2rem;">
                <canvas id="forecastLineChart"></canvas>
            </div>

            <div style="background: #ffffff; padding: 1.5rem; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03);">
                <div style="display: grid; grid-template-columns: 1.3fr 1fr; gap: 2.5rem; align-items: start;">
                    <div>
                        <h5 style="margin:0 0 10px 0; font-size:0.85rem; color:#1e293b; text-transform:uppercase; letter-spacing:0.04em; font-weight:800; display:flex; align-items:center; gap:8px;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4M12 8h.01"></path></svg>
                            Guía de Interpretación
                        </h5>
                        <p style="margin:0; font-size:0.8rem; color:#475569; line-height:1.6;">
                            El gráfico simula el <strong>agotamiento diario</strong> de tu inventario. Cuando la línea toca el fondo, indica el día proyectado de quiebre de stock.
                        </p>
                    </div>
                    
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.75rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span style="width:14px; height:3px; background:#ef4444; border-radius:10px; display:inline-block;"></span>
                                <span style="color:#1e293b; font-weight:600;">Máximo Riesgo</span>
                            </div>
                            <span style="color:#64748b; font-size:0.75rem;">Venta acelerada (+25%)</span>
                        </div>
                        <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.75rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span style="width:14px; height:3px; background:#8b5cf6; border-radius:10px; display:inline-block;"></span>
                                <span style="color:#1e293b; font-weight:600;">Demanda Base</span>
                            </div>
                            <span style="color:#64748b; font-size:0.75rem;">Ritmo habitual</span>
                        </div>
                        <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.75rem;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span style="width:14px; height:3px; background:#3b82f6; border-radius:10px; display:inline-block;"></span>
                                <span style="color:#1e293b; font-weight:600;">Escenario Lento</span>
                            </div>
                            <span style="color:#64748b; font-size:0.75rem;">Si la venta baja (-25%)</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Destruir instancia previa si existe para evitar fugas y problemas de redimensionado "infinitos"
        if (window.forecastChartInstance) {
            window.forecastChartInstance.destroy();
        }

        const ctx = document.getElementById('forecastLineChart').getContext('2d');
        const labels = Array.from({ length: 31 }, (_, i) => `Día ${i}`);
        const dailyBurn = ventaEsperada / 30;

        window.forecastChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Ventas Normales (Esenario Base)',
                        data: labels.map((_, i) => Math.max(0, stockActual - (dailyBurn * i))),
                        borderColor: '#8b5cf6',
                        backgroundColor: 'rgba(139, 92, 246, 0.05)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0
                    },
                    {
                        label: 'Ventas Aceleradas (+25%)',
                        data: labels.map((_, i) => Math.max(0, stockActual - (dailyBurn * 1.25 * i))),
                        borderColor: '#ef4444',
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0
                    },
                    {
                        label: 'Ventas Lentas (-25%)',
                        data: labels.map((_, i) => Math.max(0, stockActual - (dailyBurn * 0.75 * i))),
                        borderColor: '#3b82f6',
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            boxWidth: 12,
                            font: { size: 11, weight: '600' },
                            padding: 20
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function (context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += Math.round(context.parsed.y).toLocaleString('es-CL') + ' unid.';
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Días Proyectados', font: { weight: '800', size: 10 } },
                        ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10, font: { size: 9 } }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Stock Disponible (Unidades)', font: { weight: '800', size: 10 } },
                        ticks: { font: { size: 9 } }
                    }
                }
            }
        });
    } catch (err) {
        console.error("Error al renderizar proyecciones no-técnicas:", err);
        const container = document.getElementById('forecastVisualContainer');
        if (container) {
            container.innerHTML = `<div style = "padding: 2rem; text-align: center; color: #ef4444; font-size: 0.9rem;" > Ocurrió un error al cargar las proyecciones.Revisa la consola o recarga la página.</div> `;
        }
    }
}

window.agregarAlPedido = function (producto, cantidad, escenario, btn) {
    if (!window.ITEMS_ORDEN) window.ITEMS_ORDEN = new Map();
    const key = producto; // Clave única por nombre para coherencia numérica (HU-Consistencia)
    let existingItem = window.ITEMS_ORDEN.get(key);
    let existingQty = existingItem ? existingItem.cantidad : 0;

    window.ITEMS_ORDEN.set(key, {
        producto,
        cantidad: cantidad + existingQty,
        escenario: existingItem ? 'Actualización por demanda' : escenario,
        fecha: new Date().toLocaleDateString()
    });

    window._guardarPersistenciaOrden();
    showToast(`Agregado a la orden: ${Math.round(cantidad)} unidades de ${producto} `, 'success');

    if (btn) {
        btn.innerHTML = '✅ En la Orden';
        btn.style.setProperty('background-color', '#8b5cf6', 'important');
        btn.style.setProperty('border-color', '#7c3aed', 'important');
        btn.style.setProperty('color', 'white', 'important');
        btn.disabled = true;
    }


    window.actualizarContadoresOrden();
}

window.actualizarContadoresOrden = function () {
    if (!window.ITEMS_ORDEN) return;
    const count = window.ITEMS_ORDEN.size;

    // 1. Sincronizar badges (header y botón flotante)
    const badgeHeader = document.getElementById("orderCountBadge");
    const badgeBtn = document.getElementById("orderCountBadgeMain");
    const btnReponer = document.getElementById("btnCopilotReposition");

    [badgeHeader, badgeBtn].forEach(badge => {
        if (!badge) return;
        badge.textContent = count;
        if (count > 0) {
            badge.style.setProperty('display', 'flex', 'important');
        } else {
            badge.style.setProperty('display', 'none', 'important');
        }
    });

    // 2. Sincronizar el botón principal de reposición
    if (btnReponer) {
        const yaReponiendo = Array.from(window.ITEMS_ORDEN.values())
            .some(it => it.escenario && it.escenario.includes("Sugerencia del Sistema"));

        if (yaReponiendo) {
            btnReponer.innerHTML = '✅ Reposición Programada';
            btnReponer.disabled = true;
            btnReponer.style.opacity = '0.7';
            btnReponer.style.cursor = 'default';
        } else {
            btnReponer.innerHTML = '🛒 Iniciar Reposición';
            btnReponer.disabled = false;
            btnReponer.style.opacity = '1';
            btnReponer.style.cursor = 'pointer';
        }
    }

    // 3. Efecto visual de actualización
    const orderStatus = document.getElementById("orderStatus");
    if (orderStatus && count > 0) {
        orderStatus.style.transition = 'all 0.3s ease';
        orderStatus.style.transform = 'scale(1.1)';
        orderStatus.style.color = '#7c3aed';
        setTimeout(() => {
            orderStatus.style.transform = 'scale(1)';
            orderStatus.style.color = '';
        }, 300);
    }
};

// ---- LOGICA DE ORDENES (DRAFT PO) ----

window.ejecutarReponerAhoraCopilot = function () {
    const btn = document.getElementById("btnCopilotReposition");
    if (!window.LAST_FORECAST_DATA || !window.LAST_FORECAST_DATA.alertas_quiebre) {
        showToast("No hay datos de quiebre cargados para generar la orden automática.", "info");
        return;
    }

    const criticos = window.LAST_FORECAST_DATA.alertas_quiebre;
    if (criticos.length === 0) {
        showToast("No hay elementos en riesgo de quiebre.", "info");
    } else {
        if (!window.ITEMS_ORDEN) window.ITEMS_ORDEN = new Map();

        // --- MIGRACIÓN Y CONSOLIDACIÓN (HU-COHERENCIA) ---
        // Si hay llaves antiguas (ej: "Producto | Alerta"), las unificamos todas al nombre limpio
        const backup = Array.from(window.ITEMS_ORDEN.entries());
        window.ITEMS_ORDEN.clear();
        backup.forEach(([oldKey, oldVal]) => {
            const cleanKey = oldVal.producto; // Usar el nombre guardado dentro del objeto
            const existing = window.ITEMS_ORDEN.get(cleanKey);
            const currentQty = existing ? existing.cantidad : 0;
            window.ITEMS_ORDEN.set(cleanKey, {
                ...oldVal,
                cantidad: oldVal.cantidad + currentQty
            });
        });

        const escenarioText = "Sugerencia del Sistema: Evitar Quiebre";
        const productosProcesados = new Set();

        criticos.forEach(it => {
            const producto = it.nombre_producto;
            const qty = Math.max(1, Math.round(it.proyeccion_mensual || 0));
            const key = producto;

            const existing = window.ITEMS_ORDEN.get(key);

            // HU-CONSISTENCIA: Si ya se agregó por el Copilot, no sumamos dos veces. 
            // Reemplazamos por la sugerencia más reciente (idempotencia).
            const yaAgregadoAuto = existing && existing.escenario === escenarioText;

            window.ITEMS_ORDEN.set(key, {
                producto: producto,
                cantidad: yaAgregadoAuto ? qty : qty + (existing ? existing.cantidad : 0),
                escenario: escenarioText,
                fecha: new Date().toLocaleDateString()
            });
            productosProcesados.add(producto);
        });

        window._guardarPersistenciaOrden();

        // Actualizar UI del Botón (Solicitud del Usuario)
        if (btn) {
            btn.innerHTML = '✅ Reposición Programada';
            btn.disabled = true;
            btn.style.opacity = '0.7';
            btn.style.cursor = 'default';
        }

        // Explicación detallada para el usuario
        const msg = `Se han procesado ${productosProcesados.size} productos críticos. Tu pedido ha sido actualizado y consolidado para evitar quiebres.`;
        showToast(msg, "success");

        window.actualizarContadoresOrden();
    }

    window.toggleResumenOrden();
};

window.toggleResumenOrden = function () {
    const drawer = document.getElementById("orderDrawer");
    const overlay = document.getElementById("drawerOverlay");
    if (!drawer || !overlay) return;

    const isActive = drawer.classList.contains("active");
    if (!isActive) {
        window.actualizarListaOrden();
        drawer.classList.add("active");
        overlay.classList.add("active");
        document.body.style.overflow = 'hidden';
    } else {
        drawer.classList.remove("active");
        overlay.classList.remove("active");
        document.body.style.overflow = '';
    }
};

// Accepts mapKey directly (the exact key in ITEMS_ORDEN)
window.actualizarCantidadItemOrden = function (mapKey, element) {
    if (window.ITEMS_ORDEN && window.ITEMS_ORDEN.has(mapKey)) {
        let val = parseFloat(element.value);
        if (isNaN(val) || val < 1) val = 1;
        const item = window.ITEMS_ORDEN.get(mapKey);
        item.cantidad = val;
        window.ITEMS_ORDEN.set(mapKey, item);
        window._guardarPersistenciaOrden();
        let sum = 0;
        window.ITEMS_ORDEN.forEach(i => sum += i.cantidad);
        const totalEl = document.getElementById("totalUnitsOrdered");
        if (totalEl) totalEl.textContent = Math.round(sum).toLocaleString('es-CL');
    }
};

window.actualizarListaOrden = function () {
    const container = document.getElementById("orderItemsContainer");
    const totalEl = document.getElementById("totalUnitsOrdered");
    if (!container || !totalEl) return;

    if (!window.ITEMS_ORDEN || window.ITEMS_ORDEN.size === 0) {
        container.innerHTML = `
            <div style = "text-align:center; padding:4rem 2rem; color:#94a3b8;" >
                <div style="font-size:3rem; margin-bottom:1rem;">🛒</div>
                <p style="font-weight:600; margin-bottom:4px;">Tu orden está vacía</p>
                <p style="font-size:0.85rem;">Simula escenarios de demanda y agrega productos faltantes para verlos aquí.</p>
            </div> `;
        totalEl.textContent = '0';
        return;
    }

    let totalUnits = 0;
    let html = '';

    Array.from(window.ITEMS_ORDEN.entries()).forEach(([mapKey, item]) => {
        totalUnits += item.cantidad;
        const keyEscaped = mapKey.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const prodEscaped = item.producto.replace(/'/g, "\\'").replace(/"/g, "&quot;");
        const escEscaped = item.escenario.replace(/'/g, "\\'").replace(/"/g, "&quot;");

        // Buscar stock actual
        let currentStock = 'N/D';
        if (typeof DATOS_CRUDOS !== 'undefined' && DATOS_CRUDOS) {
            const found = DATOS_CRUDOS.find(d => d.nombre_producto === item.producto);
            if (found) currentStock = found.stock_actual || found.unidades || 0;
        }

        html += `
            <div class="order-item-card" >
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                    <strong style="color:var(--ss-text-main); font-size:1rem;">${item.producto}</strong>
                    <button onclick="window.eliminarDeOrden('${keyEscaped}')" 
                            style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1.1rem; padding:0 4px;">&times;</button>
                </div>
                <div style="font-size:0.85rem; color:#64748b;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin:4px 0;">
                        <span>Motivo: <span style="color:#ef4444; font-weight:700;">${item.escenario.split(':')[0]}</span></span>
                        <span style="color:#0f172a; font-weight:600; background:#f1f5f9; padding:2px 6px; border-radius:4px; font-size:0.75rem;">📦 Stock actual: ${currentStock}</span>
                    </div>
                    <div style="margin-top:8px; display:flex; align-items:center; gap:8px;">
                        <span>Cantidad a reponer:</span>
                        <input type="number" min="1" step="1" 
                               value="${Math.round(item.cantidad)}" 
                               onchange="window.actualizarCantidadItemOrden('${keyEscaped}', this)"
                               style="width:80px; padding:4px 8px; border-radius:6px; border:1px solid #cbd5e1; outline:none; font-family:inherit;">
                        <span>unid.</span>
                    </div>
                </div>
            </div>
            `;
    });

    container.innerHTML = html;
    totalEl.textContent = Math.round(totalUnits).toLocaleString('es-CL');
};

window.eliminarDeOrden = function (mapKey) {
    // mapKey is the exact key stored in ITEMS_ORDEN (either 'producto' or 'producto|escenario')
    const item = window.ITEMS_ORDEN.get(mapKey);
    const producto = item ? item.producto : mapKey;
    const escenario = item ? item.escenario : '';

    const deleted = window.ITEMS_ORDEN.delete(mapKey);

    if (deleted) {
        window._guardarPersistenciaOrden();
        window.actualizarListaOrden();

        // Sincronizar badges y botones globales (HU-Consistencia)
        window.actualizarContadoresOrden();

        // Restablecer visualmente los botones en la sección de Previsión si estuvieran activos
        try {
            document.querySelectorAll('button[onclick*="window.agregarAlPedido"]').forEach(btn => {
                const oc = btn.getAttribute('onclick') || '';
                const prodEscaped = producto.replace(/'/g, "\\'");
                if (oc.includes(`'${prodEscaped}'`)) {
                    btn.innerHTML = '🛒 Agregar a mi orden';
                    btn.disabled = false;
                    btn.style.setProperty('background-color', '#ef4444', 'important');
                    btn.style.setProperty('color', 'white', 'important');
                }
            });
        } catch (e) {
            console.error('No se pudo resetear el botón en la vista', e);
        }
    }
};


window.generarYDescargarOrdenCSV = function () {
    if (!window.ITEMS_ORDEN || window.ITEMS_ORDEN.size === 0) {
        showToast("No hay productos en la orden", "error");
        return;
    }

    let csvContent = "\ufeffProducto,Escenario,Cantidad,Fecha\n"; // \ufeff for Excel UTF-8

    Array.from(window.ITEMS_ORDEN.values()).forEach(item => {
        const row = [
            `"${item.producto}"`,
            `"${item.escenario.replace(/"/g, '""')
            }"`,
            Math.round(item.cantidad),
            `"${item.fecha}"`
        ].join(",");
        csvContent += row + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `pedido_smartstock_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("Pedido descargado con éxito", "success");
    window.toggleResumenOrden();
};

window.generarInsightEstrategicoIA = async function () {
    const panel = document.getElementById("iaResumenPanel");
    const content = document.getElementById("iaResumenContent");
    if (!panel || !content) return;

    if (!window.LAST_FORECAST_DATA) {
        showToast("Carga primero los datos del dashboard", "info");
        return;
    }

    panel.style.display = "block";
    content.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px; padding: 0.5rem 0;">
            <div class="loader" style="width:18px; height:18px; border-width:2px; border-top-color:#6d28d9;"></div>
            <span style="font-style:italic; color:#6d28d9;">Diseñando estrategia logística con IA Llama-3...</span>
        </div>
    `;

    try {
        const token = localStorage.getItem("token");
        const contexto = {
            algoritmo_ganador: window.LAST_FORECAST_DATA.mejor_algo || "Regresión Lineal",
            precision_algoritmo: window.LAST_FORECAST_DATA.precision_forecast || 85,
            variacion_precision: window.LAST_FORECAST_DATA.variacion_precision || 0,
            demanda_total: window.LAST_FORECAST_DATA.demanda_total_estimada || 0,
            valor_total_estimado: window.LAST_FORECAST_DATA.ingreso_potencial_mensual || 0,
            salud_stock: window.LAST_FORECAST_DATA.salud_stock || 0,
            total_inventario_general: window.LAST_FORECAST_DATA.total_inventario_general || 0,
            top_productos: (window.LAST_FORECAST_DATA.top_movimientos || []).map(m => m.nombre_producto),
            alertas_quiebre_count: (window.LAST_FORECAST_DATA.alertas_quiebre || []).length,
            productos_quiebre_nombres: (window.LAST_FORECAST_DATA.alertas_quiebre || []).map(a => a.nombre_producto)
        };

        const res = await fetch(`${API_URL}/api/ai/forecast-insight`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(contexto)
        });

        if (res.ok) {
            const data = await res.json();
            // Formateo avanzado de Markdown para el insight estratégico
            const formattedInsight = data.insight
                .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#6d28d9; font-weight:700;">$1</strong>')
                .replace(/^\s*[-*]\s+(.*)/gm, '<div style="display:flex; gap:8px; margin-bottom:4px; padding-left:4px;"><span>•</span><span>$1</span></div>')
                .replace(/^\s*(\d+)\.\s+(.*)/gm, '<div style="display:flex; gap:8px; margin-bottom:4px; padding-left:4px;"><span style="font-weight:700; color:#6d28d9;">$1.</span><span>$2</span></div>')
                .replace(/\n\n/g, '<div style="margin-bottom:12px;"></div>')
                .replace(/\n/g, '<br>');

            content.innerHTML = `
                <div style="display:flex; gap:12px; align-items:flex-start;">
                    <span style="font-size:1.5rem; filter:drop-shadow(0 2px 4px rgba(109,40,217,0.2));">💡</span>
                    <div style="animation: fadeIn 0.8s ease; font-size:0.85rem; line-height:1.6; color:#1e293b;">
                        <div style="margin-bottom:8px; font-weight:800; color:#6d28d9; text-transform:uppercase; font-size:0.7rem; letter-spacing:0.05em;">Análisis Estratégico IA</div>
                        ${formattedInsight}
                    </div>
                </div>
            `;
        } else {
            content.innerText = "El motor de IA está ocupado. Intenta de nuevo en unos segundos.";
        }
    } catch (e) {
        console.error(e);
        content.innerText = "Error de conexión con el núcleo de inteligencia.";
    }
};

// ---- LOGICA INSPECTOR DE DATOS ----
async function verificarEstadoDatos() {
    try {
        const hasData = DATOS_CRUDOS.length > 0;
        const hasMapData = DATOS_CRUDOS.some(item => item.latitud || item.lat);

        const tabs = ["control-maestro", "sensibilidad", "impacto-social"];
        tabs.forEach(t => {
            const btn = document.querySelector(`.sidebar-item[data-tab="${t}"]`);
            if (btn) btn.style.display = "flex";
        });

        const mapBtn = document.querySelector('.sidebar-item[data-tab="logistica"]');
        // Mostrar tab si tiene coordenadas geo O si tiene nombre de ubicación (sucursal sin geo)
        const tieneSucursalData = DATOS_CRUDOS.some(item => item.nombre_ubicacion);
        const hasGeoData = hasMapData || tieneSucursalData || (typeof INDICADORES !== 'undefined' && INDICADORES.has_geo) || (typeof INDICADORES !== 'undefined' && INDICADORES.has_branches);
        if (mapBtn) mapBtn.style.display = hasGeoData ? 'flex' : 'none';


        // ELIMINADO: Ya no abrimos el portal automáticamente aquí para evitar el loop infinito al refrescar
    } catch (e) {
        console.error("Error verificando el estado de datos:", e);
    }
}

// Resetea todas las vistas del dashboard cuando no hay datos
function vaciarTablero(motivo = "no_files") {
    renderizarIndicadores();
    // 1. Limpiar Indicadores
    const categorias = ["vencido", "critico", "urgente", "preventivo", "normal"];
    categorias.forEach(id => {
        const prodEl = document.getElementById(`val-${id}-prod`);
        const unidEl = document.getElementById(`val-${id}-unid`);
        const clpEl = document.getElementById(`val-${id}-clp`);
        if (prodEl) prodEl.textContent = "0";
        if (unidEl) unidEl.textContent = "0";
        if (clpEl) clpEl.textContent = "$0";
    });
    const totalEl = document.getElementById("totalValorRiesgo");
    if (totalEl) totalEl.textContent = "$0";

    // 2. Limpiar Gráficos
    ["chartProductos", "chartValor", "chartUnidades"].forEach(id => {
        if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
    });
    const legendEl = document.getElementById("sharedChartLegend");
    if (legendEl) legendEl.innerHTML = "";

    // 3. Limpiar Tabla de Acciones con mensaje contextual
    const tableContainer = document.getElementById("cuerpo-tabla-inventario");
    if (tableContainer) {
        if (motivo === "no_files") {
            tableContainer.innerHTML = `<div style="padding:3rem; text-align:center; color:#6b7280;">
                <span style="font-size:3rem; display:block; margin-bottom:1rem;">📂</span>
                <p style="font-weight:600; font-size:1.1rem; color:var(--text-main);">Sin archivos activos</p>
                <p style="font-size:0.9rem;">Sube un archivo en el Inspector para iniciar el análisis.</p>
            </div>`;
        } else {
            tableContainer.innerHTML = `<div style="padding:3rem; text-align:center; color:#6b7280;">
                <span style="font-size:3rem; display:block; margin-bottom:1rem;">⚠️</span>
                <p style="font-weight:600; font-size:1.1rem; color:var(--text-main);">Sin coincidencias</p>
                <p style="font-size:0.9rem;">No se han encontrado productos que venzan en el periodo seleccionado.</p>
            </div>`;
        }
    }

    // 4. Limpiar Mapa
    if (window.markersLayer) window.markersLayer.clearLayers();

    // 5. Limpiar Insights de IA
    const aiContainer = document.getElementById("aiInsightsList");
    if (aiContainer) {
        if (motivo === "no_files") {
            aiContainer.innerHTML = `
                <div class="insight-card anomalia-bg">
                    <h4 class="anomalia-text">⚠️ Sin datos</h4>
                    <p>Sube un archivo en el Inspector para iniciar el análisis.</p>
                </div>
            `;
        } else {
            aiContainer.innerHTML = `
                <div class="insight-card caution-bg">
                    <h4 class="caution-text">🔎 Sin resultados</h4>
                    <p>No hay inventario con vencimiento para los filtros seleccionados.</p>
                </div>
            `;
        }
    }

    // 6. Limpiar KPIs de Sustentabilidad
    if (motivo === "no_files") {
        const resetTextContent = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };
        resetTextContent("impact-total-ahorro", "$0");
        resetTextContent("impact-total-merma", "$0");
        resetTextContent("impact-total-value", "$0");
        resetTextContent("impact-total-co2", "0 <small>kg</small>");
        resetTextContent("impact-total-meals", "0");
        resetTextContent("pct-recupero-label", "--% del Riesgo Evitado");

        const tableArea = document.getElementById("tableAreaImpacto");
        if (tableArea) {
            tableArea.innerHTML = `
                <div style="text-align:center; padding:4rem 2rem; color:#94a3b8;">
                    <div style="font-size:4rem; margin-bottom:1rem; opacity:0.3;">🌱</div>
                    <h3 style="color:#1e293b; margin-bottom:0.5rem; font-weight:700;">Gestión de Impacto</h3>
                    <p style="font-size:0.9rem; max-width:400px; margin:0 auto;">Procesa planes de acción en la sección principal para registrar tus iniciativas ambientales y de donación social.</p>
                </div>`;
        }
    }

    // 6. Limpiar Pestaña de Sensibilidad
    const simListEl = document.getElementById("productSimList");
    if (simListEl) simListEl.innerHTML = "";
    const sensGridEl = document.getElementById("sensitivityGrid");
    if (sensGridEl) {
        sensGridEl.innerHTML = `
            <div class="empty-state-sensitivity">
                <span style="font-size: 3rem; margin-bottom: 1rem;">🔍</span>
                <p>Seleccione un producto para ver el análisis de sensibilidad.</p>
            </div>
        `;
    }
}

// Alias para el flujo de reset
window.limpiarTableroUI = vaciarTablero;

window.manejarSubidaArchivo = async function (input, modo = "fusionar") {
    if (!input.files || input.files.length === 0) return;

    const files = Array.from(input.files);
    const statusEl = document.getElementById("uploadStatus");

    statusEl.innerHTML = `<span style="color: #ea580c;">⏳ Subiendo ${files.length} archivo(s) en modo ${modo}...</span>`;
    statusEl.style.display = "block";

    try {
        const token = localStorage.getItem("token");

        // RESET INMEDIATO DE MÉTRICAS (PROACTIVIDAD)
        if (modo === "nuevo") {
            const idsReset = ["impact-total-ahorro", "impact-total-value", "impact-total-co2", "impact-total-meals"];
            idsReset.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = id.includes("co2") ? "0.0 kg" : "$0";
            });
        }

        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            // Si es 'nuevo', solo el primero limpia, los demás fusionan para ser robustos
            const modoEnvio = (modo === "nuevo" && i > 0) ? "fusionar" : modo;

            statusEl.innerHTML = `<span style="color: #ea580c;">⏳ Subiendo archivo ${i + 1} de ${files.length}: ${file.name}...</span>`;

            const formData = new FormData();
            formData.append("file", file);

            const res = await fetch(`${API_URL}/api/data/upload?modo=${modoEnvio}`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` },
                body: formData
            });

            if (res.status === 401) {
                localStorage.removeItem("token");
                window.location.href = "index.html";
                return;
            }

            const data = await res.json();
            if (!res.ok) throw new Error(data.detalle || data.detail || `Error subiendo ${file.name}`);
        }

        statusEl.innerHTML = `<span style="color: #16a34a;">✅ ¡Inventario procesado y sincronizado!</span>`;

        // RE-SINCRONIZACIÓN TOTAL DEL TABLERO
        if (window.cargarListaArchivos) await window.cargarListaArchivos();
        if (window.verificarEstadoDatos) await window.verificarEstadoDatos();
        if (window.cargarSesiones) await window.cargarSesiones();

        if (document.getElementById("control-maestro")) {
            await inicializarTablero();
        }

        // Refrescar KPI de Impacto Social / Sustentabilidad
        if (typeof cargarImpactoSocial === "function") {
            await cargarImpactoSocial();
        }

        input.value = "";
    } catch (err) {
        statusEl.innerHTML = `<span style="color: #ef4444;">❌ Error: ${err.message}</span>`;
    }
}

window.eliminarArchivo = async function (filename) {
    const token = localStorage.getItem("token");

    const confirm = await Swal.fire({
        title: "¿Borrar archivo?",
        text: `Se eliminará "${filename}" de forma definitiva del sistema.`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Sí, eliminar",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#ef4444"
    });

    if (!confirm.isConfirmed) return;

    try {
        const res = await fetch(`${API_URL}/api/data/files/${encodeURIComponent(filename)}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (res.ok) {
            showToast("Archivo eliminado del servidor", "success");
            await refrescarUITrasCambioDato(filename);
        } else {
            const err = await res.json();
            showToast("Error al eliminar: " + (err.detail || "Error desconocido"), "error");
        }
    } catch (err) {
        showToast("Error de conexión", "error");
    }
};

async function refrescarUITrasCambioDato(filename) {
    if (window.cargarListaArchivos) await window.cargarListaArchivos();
    verificarEstadoDatos();
    if (typeof cargarImpactoSocial === "function") await cargarImpactoSocial();

    const currentTitle = document.getElementById("selectedFileName")?.textContent;
    if (currentTitle && currentTitle.includes(filename)) {
        volverAEstadoVacioInspector();
    }

    if (typeof inicializarTablero === "function") await inicializarTablero();
    if (typeof renderizarListaAnalisis === "function") await window.renderizarListaAnalisis();
}

function volverAEstadoVacioInspector() {
    const titleEl = document.getElementById("selectedFileName");
    const contentEl = document.getElementById("inspectorContent");
    if (!titleEl || !contentEl) return; // Added null check for contentEl
    titleEl.textContent = "Selecciona un archivo";
    contentEl.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #9ca3af; text-align: center;">
            <span style="font-size: 3rem; margin-bottom: 1rem;">📊</span>
            <p style="font-size: 1.1rem; color: #4b5563; font-weight: 500;">Seleccione un archivo para analizar</p>
            <p style="font-size: 0.9rem; max-width: 300px; margin-top: 0.5rem;">Haga clic en un archivo de la lista lateral para cargar su estructura y análisis estadístico.</p>
        </div>
    `;
}

async function resetearBaseDatos() {
    if (!confirm("⚠ ¿Estás COMPLETAMENTE seguro de eliminar TODOS los archivos subidos? Esto limpiará totalmente el tablero.")) return;

    try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_URL}/api/data/reset`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (res.ok) {
            showToast("Todos los archivos han sido eliminados", "success");

            // Forzar limpieza de estado local
            DATOS_CRUDOS = [];
            METRICAS = {};

            if (typeof vaciarTablero === "function") {
                vaciarTablero();
            }

            if (window.cargarListaArchivos) await window.cargarListaArchivos();
            verificarEstadoDatos();
            volverAEstadoVacioInspector();

            if (typeof inicializarTablero === "function") {
                await inicializarTablero();
            }

            // Forzar actualización de sostenibilidad para que todo sea cero (G-ZERO)
            if (typeof cargarImpactoSocial === "function") {
                await cargarImpactoSocial();
            }
        } else {
            const err = await res.json();
            showToast("Error: " + (err.detalle || err.detail || "No se pudo resetear"), "error");
        }
    } catch (err) {
        showToast("Error de conexión: " + err.message, "error");
    }
}

// Guarda de upload en el Inspector: dentro de un análisis activo, no permite subir ahí
// (evita mezclar datos). Redirige a "Nuevo Análisis" desde Home si corresponde.
window.inspectorUploadClick = function () {
    if (_analisisActivo) {
        Swal.fire({
            title: 'Análisis independientes',
            html: `Para agregar nuevos datos, crea un <strong>+ Nuevo Análisis</strong> desde la pantalla de inicio.<br><br>
                   El análisis <strong>"${_analisisNombres[_analisisActivo] || _analisisActivo.replace(/\.csv$/i, '')}"</strong> es un espacio de trabajo cerrado e independiente.`,
            icon: 'info',
            confirmButtonColor: '#7c3aed',
            confirmButtonText: '← Ir a Inicio',
            showCancelButton: true,
            cancelButtonText: 'Cerrar'
        }).then(({ isConfirmed }) => {
            if (isConfirmed) document.querySelector('[data-tab="home"]')?.click();
        });
    } else {
        // Sin análisis activo: comportamiento normal de upload
        document.getElementById('fileInput')?.click();
    }
};

window.cargarListaArchivos = async function () {
    const fileListEl = document.getElementById("fileList");
    if (!fileListEl) return;
    fileListEl.innerHTML = '<li style="padding: 1rem; text-align: center; color: #6b7280;">Cargando archivos...</li>';

    try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_URL}/api/data/files`, { headers: { "Authorization": `Bearer ${token}` } });

        if (res.status === 401) {
            localStorage.removeItem("token");
            window.location.href = "index.html";
            return;
        }

        if (!res.ok) throw new Error("Error cargando archivos");
        let files = await res.json();

        // ── AISLAMIENTO: si hay un análisis activo, mostrar SOLO sus archivos ──
        if (_analisisActivo) {
            try {
                const resAn = await fetch(`${API_URL}/api/analyses`, { headers: { "Authorization": `Bearer ${token}` } });
                if (resAn.ok) {
                    const analyses = await resAn.json();
                    const activeAn = analyses.find(a => a.id === _analisisActivo);
                    if (activeAn && activeAn.archivos) {
                        files = files.filter(f => activeAn.archivos.includes(f.nombre || f.name || f));
                    } else {
                        files = [];
                    }
                } else {
                    files = [];
                }
            } catch (e) {
                console.error("Error aislando archivos:", e);
                files = [];
            }
        }

        // Actualizar badge de conteo
        const countBadge = document.getElementById('inspector-count-badge');
        if (countBadge) {
            if (files.length > 0) {
                countBadge.textContent = `${files.length} fuente${files.length > 1 ? 's' : ''}`;
                countBadge.style.display = 'inline-block';
            } else {
                countBadge.style.display = 'none';
            }
        }

        if (files.length === 0) {
            fileListEl.innerHTML = '<li style="padding: 1rem; text-align: center;">No hay archivos. ¡Sube uno!</li>';
            if (DATOS_CRUDOS.length > 0) {
                DATOS_CRUDOS = [];
                if (typeof vaciarTablero === "function") vaciarTablero();
            }
            return;
        }

        fileListEl.innerHTML = "";

        files.forEach(f => {
            const fn = f.nombre || f.name || f;
            // Nombre limpio: usa el display name sin extensión
            const displayName = _analisisNombres[fn] || fn.replace(/\.(csv|xlsx|xls)$/i, "");

            const li = document.createElement("li");
            li.className = "file-item";
            li.style.cssText = `
                display: flex; align-items: center; gap: 10px;
                padding: 10px 12px; border-radius: 8px; cursor: pointer;
                border: 1.5px solid transparent; transition: all 0.15s;
                background: #f8fafc; margin-bottom: 6px;
            `;
            li.innerHTML = `
                <!-- Ícono de dataset -->
                <div style="width:32px; height:32px; border-radius:7px; background:rgba(99,102,241,0.1);
                            display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6366f1"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                        <path d="M3 5v6c0 1.657 4.03 3 9 3s9-1.343 9-3V5"></path>
                        <path d="M3 11v6c0 1.657 4.03 3 9 3s9-1.343 9-3v-6"></path>
                    </svg>
                </div>
                <!-- Nombre + meta -->
                <div style="flex:1; min-width:0;">
                    <div style="font-size:0.85rem; font-weight:700; color:#1e293b;
                                white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
                         title="${displayName}">${displayName}</div>
                    <div style="font-size:0.7rem; color:#94a3b8; margin-top:1px;">${f.size || ''}</div>
                </div>
                <!-- Botón eliminar -->
                <button class="btn-delete-file" title="Eliminar este análisis"
                    style="flex-shrink:0; background:transparent; border:none; color:#cbd5e1;
                           cursor:pointer; font-size:1rem; line-height:1; padding:4px 6px;
                           border-radius:4px; transition:all 0.15s;"
                    onmouseenter="this.style.color='#ef4444'; this.style.background='#fef2f2';"
                    onmouseleave="this.style.color='#cbd5e1'; this.style.background='transparent';">×</button>
            `;

            // Hover state
            li.onmouseenter = () => {
                if (!li.classList.contains('active')) {
                    li.style.borderColor = 'var(--ss-blue, #6366f1)';
                    li.style.background = 'rgba(99,102,241,0.04)';
                }
            };
            li.onmouseleave = () => {
                if (!li.classList.contains('active')) {
                    li.style.borderColor = 'transparent';
                    li.style.background = '#f8fafc';
                }
            };

            // Click para cargar esquema
            li.onclick = (e) => {
                if (e.target.closest('.btn-delete-file')) return;
                fileListEl.querySelectorAll('.file-item').forEach(el => {
                    el.classList.remove('active');
                    el.style.borderColor = 'transparent';
                    el.style.background = '#f8fafc';
                });
                li.classList.add('active');
                li.style.borderColor = 'var(--ss-blue, #6366f1)';
                li.style.background = 'rgba(99,102,241,0.06)';
                cargarEsquema(fn);
            };

            // Click en X para eliminar
            li.querySelector(".btn-delete-file").onclick = (e) => {
                e.stopPropagation();
                eliminarArchivo(fn);
            };

            fileListEl.appendChild(li);
        });

        // Auto-seleccionar el primer archivo
        const primerNombre = files[0]?.nombre || files[0]?.name || files[0];
        if (primerNombre) {
            window.cargarEsquema(primerNombre);
            const items = fileListEl.querySelectorAll('.file-item');
            if (items.length > 0) {
                items[0].classList.add('active');
                items[0].style.borderColor = 'var(--ss-blue, #6366f1)';
                items[0].style.background = 'rgba(99,102,241,0.06)';
            }
        }

    } catch (err) {
        fileListEl.innerHTML = `<li style="padding: 1rem; text-align: center; color: #ef4444;">Error: ${err.message}</li>`;
    }
}

window.cargarEsquema = async function (filename) {
    const contentEl = document.getElementById("inspectorContent");
    const titleEl = document.getElementById("selectedFileName");
    if (!contentEl || !titleEl) return;

    titleEl.textContent = `Analizando: ${filename}`;
    const tabs = document.getElementById("inspectorTabs");
    if (tabs) tabs.style.display = "flex";
    contentEl.innerHTML = '<p style="color: #6b7280;">Cargando esquema...</p>';

    try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_URL}/api/data/schema/${filename}`, { headers: { "Authorization": `Bearer ${token}` } });
        if (!res.ok) throw new Error("Error leyendo el archivo");
        const schema = await res.json();

        let html = `
            <div style="margin-bottom: 2rem;">
                <div style="display: flex; gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="background: #f8fafc; padding: 0.75rem 1.25rem; border-radius: 8px; border: 1px solid #e2e8f0; flex: 1;">
                        <span style="color: #64748b; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">Columnas Detectadas</span>
                        <div style="font-size: 1.5rem; font-weight: 700; color: #0f172a; margin-top: 0.25rem;">${schema.columns.length}</div>
                    </div>
                    <div style="background: #f8fafc; padding: 0.75rem 1.25rem; border-radius: 8px; border: 1px solid #e2e8f0; flex: 1;">
                        <span style="color: #64748b; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">Total de Filas</span>
                        <div style="font-size: 1.5rem; font-weight: 700; color: #0f172a; margin-top: 0.25rem;">${schema.total_rows}</div>
                    </div>
                </div>
            </div>

            <div style="margin-bottom: 2rem;">
                <h4 style="margin-bottom: 0.8rem; color: #4b5563;">Análisis Estadístico</h4>
                ${schema.statistics && Object.keys(schema.statistics).length > 0 ? `
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.25rem;">
                        ${Object.entries(schema.statistics).map(([col, stats]) => `
                            <div class="stat-card" style="padding: 0.8rem; border-top: 3px solid #8b5cf6; background: white; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 0.6rem; min-width: 0;">
                                <div style="border-bottom: 1px solid #f1f5f9; padding-bottom: 0.4rem; overflow: hidden;">
                                    <h5 style="margin: 0; font-size: 0.65rem; color: #1e293b; font-weight: 900; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;" title="${col}">${col.replace(/_/g, ' ')}</h5>
                                </div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem;">
                                    <div style="background: #f8fafc; padding: 0.35rem 0.5rem; border-radius: 6px; border: 1px solid #f1f5f9;">
                                        <div style="color: #64748b; font-size: 0.5rem; font-weight: 700; text-transform: uppercase; margin-bottom: 0.1rem;">Promedio</div>
                                        <div style="font-weight: 800; color: #0f172a; font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${stats.mean !== null ? Number(stats.mean).toLocaleString('es-CL', { maximumFractionDigits: 1 }) : '-'}</div>
                                    </div>
                                    <div style="background: #f8fafc; padding: 0.35rem 0.5rem; border-radius: 6px; border: 1px solid #f1f5f9;">
                                        <div style="color: #64748b; font-size: 0.5rem; font-weight: 700; text-transform: uppercase; margin-bottom: 0.1rem;">Desv. Est.</div>
                                        <div style="font-weight: 800; color: #0f172a; font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${stats.std !== null ? Number(stats.std).toFixed(1) : '-'}</div>
                                    </div>
                                    <div style="background: #fff5f5; padding: 0.35rem 0.5rem; border-radius: 6px; border: 1px solid #fee2e2;">
                                        <div style="color: #c53030; font-size: 0.5rem; font-weight: 700; text-transform: uppercase; margin-bottom: 0.1rem;">Mínimo</div>
                                        <div style="color: #e53e3e; font-weight: 800; font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${stats.min !== null ? Number(stats.min).toLocaleString('es-CL') : '-'}</div>
                                    </div>
                                    <div style="background: #f0fff4; padding: 0.35rem 0.5rem; border-radius: 6px; border: 1px solid #dcfce7;">
                                        <div style="color: #2f855a; font-size: 0.5rem; font-weight: 700; text-transform: uppercase; margin-bottom: 0.1rem;">Máximo</div>
                                        <div style="color: #38a169; font-weight: 800; font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${stats.max !== null ? Number(stats.max).toLocaleString('es-CL') : '-'}</div>
                                    </div>
                                </div>
                                <div style="background: linear-gradient(to right, #faf5ff, #f3e8ff); padding: 0.4rem 0.6rem; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(168, 85, 247, 0.1); gap: 1rem;">
                                    <div style="color: #7e22ce; font-size: 0.55rem; font-weight: 900; text-transform: uppercase; flex-shrink: 0;">Sumatoria</div>
                                    <div style="color: #6b21a8; font-weight: 900; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right; flex: 1;">${stats.sum !== null ? Number(stats.sum).toLocaleString('es-CL') : '-'}</div>
                                </div>
                                ${(col.toLowerCase().includes('stock') || col.toLowerCase().includes('cantidad')) && stats.min < 0 ? `
                                    <div style="margin-top: 0.5rem; background: #fff1f2; border: 1px solid #fda4af; padding: 0.5rem; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                                        <span style="font-size: 1rem;">⚠️</span>
                                        <div style="color: #9f1239; font-size: 0.65rem; font-weight: 700; line-height: 1.2;">
                                            ¡Ojo! Tienes productos con stock negativo. Revisa tus registros.
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                        `).join("")}
                    </div>
                ` : '<div style="padding: 1rem; background: #f9fafb; border-radius: 6px; color: #6b7280; font-size: 0.9rem;">No hay columnas numéricas para analizar.</div>'}
            </div>

            <div>
                <h4 style="margin-bottom: 0.5rem; color: #4b5563;">Muestra de Datos</h4>
                <div style="overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 6px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; white-space: nowrap;">
                        <thead>
                            <tr style="background: #f9fafb;">
                                ${schema.columns.map((c, i) => `
                                    <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">
                                        <div style="font-weight: 600; color: #1f2937;">${c}</div>
                                        <div style="color: #8b5cf6; font-size: 0.7rem; font-family: monospace; margin-top: 0.25rem;">${schema.dtypes[i]}</div>
                                    </th>
                                `).join("")}
                            </tr>
                        </thead>
                        <tbody>
                            ${schema.sample.map(row => `<tr>${schema.columns.map(c => `<td style="padding: 8px; border-bottom: 1px solid #f3f4f6;">${row[c] !== null ? row[c] : '<span style="color:#d1d5db">null</span>'}</td>`).join("")}</tr>`).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        contentEl.innerHTML = html;
    } catch (err) {
        contentEl.innerHTML = `<p style="color: #ef4444;">Error: ${err.message}</p>`;
    }
};

window.revertirDonacion = async function (donationId) {
    if (!confirm("¿Seguro que deseas revertir esta donación? El stock se devolverá al inventario.")) return;

    try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_URL}/api/donations/${donationId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (res.ok) {
            showToast("Donación revertida con éxito.", "success");
            // Limpiar el SET para que el botón de donar vuelva a aparecer
            // Como no tenemos el id_producto aquí directamente de forma limpia sin buscar,
            // lo más fácil es reiniciar el tab de impacto y el tablero completo.
            cargarImpactoSocial();
            DONACIONES_RECIENTES.clear(); // Limpiamos para que se repueble al inicializar
            inicializarTablero();
        } else {
            showToast("Error al revertir la donación", "error");
        }
    } catch (err) {
        showToast("Error de conexión", "error");
    }
}

// --- NUEVAS FUNCIONES DE SESIÓN Y GESTIÓN DE DATOS (HU-SES-01) ---

// --- NUEVAS FUNCIONES DE SESIÓN Y GESTIÓN DE DATOS (HU-SES-01) ---

window.cargarSesiones = async function () {
    // Deprecated: Funcionalidad de selectores de sesión heredados reemplazada
    // por la gestión aislada nativa a través de window._analisisActivo (Multi-tenant workspaces).
};

// Hook inicial para cargar sesiones
const oldReset = window.verificarEstadoDatos;
window.verificarEstadoDatos = async function () {
    if (typeof oldReset === "function") await oldReset();
    await window.cargarSesiones();
};

// --- LOGICA DEL PORTAL DE BIENVENIDA / NUEVO ANÁLISIS ---

window.mostrarPortalNuevoAnalisis = function () {
    // Si no hay datos, abrimos automáticamente el modal premium de carga (Swal)
    // Esto reemplaza el antiguo div portalNuevoAnalisis que ya no existe en el HTML
    window.abrirModalNuevoAnalisis();
};

window.ocultarPortal = function () {
    const portal = document.getElementById("portalNuevoAnalisis");
    if (portal) portal.classList.add("hidden");
};

// Modificar el cierre de sesión para limpiar todo
if (document.getElementById("logoutBtn")) {
    document.getElementById("logoutBtn").onclick = () => {
        localStorage.clear();
        window.location.href = "index.html";
    };
}

// ============================================================
// GESTIÓN DE ANÁLISIS (HOME TAB) — Sistema completo
// ============================================================

// Estado global: nombres personalizados de archivos (persiste en localStorage)
let _analisisNombres = {};
try {
    const stored = localStorage.getItem("_analisisNombres");
    if (stored) _analisisNombres = JSON.parse(stored);
} catch (e) {
    console.warn("Error parsing _analisisNombres from localStorage:", e);
}
if (!_analisisNombres || typeof _analisisNombres !== 'object') _analisisNombres = {};
let _analisisActivo = window._analisisActivo = localStorage.getItem("_analisisActivo") || null;
let _contextMenuTarget = null;  // filename del item que abrió el menú

function guardarNombres() {
    localStorage.setItem("_analisisNombres", JSON.stringify(_analisisNombres));
}

function setAnalisisActivo(analysisId) {
    _analisisActivo = window._analisisActivo = analysisId;
    localStorage.setItem("_analisisActivo", analysisId || "");

    // HU-CONFIG: Cargar estados visuales de acciones para este dataset específico
    window._cargarPersistenciaTacticas();

    // Actualizar breadcrumb con nombre del manifiesto si existe, sino con el display del análisis
    const displayName = analysisId ? (_analisisNombres[analysisId] || analysisId) : null;
    actualizarBreadcrumbAnalisis(analysisId, displayName);
}

// Cargar persistencia inicial
window._cargarPersistenciaTacticas();

function actualizarBreadcrumbAnalisis(analysisId, displayName) {
    const crumb = document.getElementById("active-analysis-crumb");
    const nameEl = document.getElementById("active-analysis-name");
    if (!crumb || !nameEl) return;
    if (analysisId && displayName) {
        nameEl.textContent = displayName;
        crumb.style.display = "inline-flex";
    } else {
        crumb.style.display = "none";
    }
}

function tiempoRelativo(ms) {
    if (!ms) return "—";
    const diff = Date.now() - ms;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 2) return "hace un momento";
    if (mins < 60) return `hace ${mins} min`;
    if (hours < 24) return `hace ${hours}h`;
    if (days === 1) return "ayer";
    return `hace ${days} días`;
}

// Renderiza la lista de análisis desde el manifesto del servidor
window.renderizarListaAnalisis = async function () {
    const container = document.getElementById("homeAnalysisList");
    if (!container) return;

    try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_URL}/api/analyses`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("No autorizado");
        let analyses = await res.json();  // array ordenado por actualizado desc

        // Aplicar orden manual si se seleccionó "name"
        const sortMode = document.getElementById("homeSort")?.value || "updated";
        if (sortMode === "name") {
            analyses.sort((a, b) => a.nombre.localeCompare(b.nombre));
        }

        const searchVal = (document.getElementById("homeSearchInput")?.value || "").toLowerCase();

        // Sincronizar nombres en caché local
        analyses.forEach(a => { _analisisNombres[a.id] = a.nombre; });
        guardarNombres();

        if (analyses.length === 0) {
            container.innerHTML = `
                <div style="padding:4rem; text-align:center; color:#94a3b8; border:2px dashed var(--ss-border); border-radius:12px;">
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 1.2rem; display:block; opacity:0.35;">
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
                        <polyline points="14.5 2 14.5 7 20 7"></polyline>
                        <line x1="12" y1="12" x2="12" y2="17"></line>
                        <line x1="9.5" y1="14.5" x2="14.5" y2="14.5"></line>
                    </svg>
                    <p style="font-weight:600; font-size:1rem; color:var(--ss-text-main); margin:0 0 6px;">Sin análisis aún</p>
                    <p style="font-size:0.85rem; margin:0 0 20px;">Crea tu primer análisis para comenzar.</p>
                    <button onclick="window.abrirModalNuevoAnalisis()"
                        style="background:var(--ss-accent); color:white; border:none; padding:9px 20px; border-radius:6px; font-weight:600; font-size:0.85rem; cursor:pointer;">
                        + Nuevo Análisis
                    </button>
                </div>`;
            return;
        }

        const rows = analyses
            .filter(a => !searchVal || a.nombre.toLowerCase().includes(searchVal))
            .map(a => {
                const isActive = _analisisActivo === a.id;
                const nArchivos = (a.archivos || []).length;
                const tsStr = tiempoRelativo(a.actualizado);
                const fuenteStr = nArchivos === 0 ? 'Sin datos' :
                    nArchivos === 1 ? '1 fuente' : `${nArchivos} fuentes`;

                return `
                <div class="analysis-row glass-card" data-analysis-id="${a.id}"
                    onclick="window.abrirAnalisis('${a.id}')"
                    style="padding:12px 20px; display:flex; align-items:center; gap:16px; border-radius:8px; box-shadow:none;
                           border:1.5px solid ${isActive ? 'var(--ss-blue)' : 'var(--ss-border)'}; transition:border-color 0.2s; cursor:pointer;
                           background:${isActive ? 'rgba(99,102,241,0.03)' : 'white'};"
                    onmouseover="if('${a.id}'!==window._analisisActivo)this.style.borderColor='var(--ss-accent)'"
                    onmouseout="if('${a.id}'!==window._analisisActivo)this.style.borderColor='var(--ss-border)'">

                    <!-- Icon -->
                    <div style="width:34px; height:34px; border-radius:8px; background:${isActive ? 'rgba(99,102,241,0.12)' : '#f1f5f9'};
                                display:flex; align-items:center; justify-content:center; color:${isActive ? 'var(--ss-blue)' : 'var(--ss-text-muted)'}; flex-shrink:0;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                            <path d="M3 5v6c0 1.657 4.03 3 9 3s9-1.343 9-3V5"></path>
                            <path d="M3 11v6c0 1.657 4.03 3 9 3s9-1.343 9-3v-6"></path>
                        </svg>
                    </div>

                    <!-- Name + meta -->
                    <div style="flex:1; min-width:0;">
                        <div class="analysis-name-display" data-filename="${a.id}"
                             style="font-size:0.95rem; font-weight:600; color:var(--ss-text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            ${a.nombre}
                        </div>
                        <div style="font-size:0.72rem; color:var(--ss-text-muted); margin-top:3px; display:flex; align-items:center; gap:8px;">
                            <span>${fuenteStr} · Actualizado ${tsStr}</span>
                            ${isActive ? '<span style="background:rgba(99,102,241,0.12); color:var(--ss-blue); padding:1px 7px; border-radius:100px; font-weight:600; font-size:0.68rem;">● Activo</span>' : ''}
                        </div>
                    </div>

                    <!-- Badge + 3-dot menu -->
                    <div style="display:flex; align-items:center; gap:12px; flex-shrink:0;">
                        <span style="background:#f1f5f9; color:var(--ss-text-muted); font-size:0.68rem; font-weight:700;
                                     padding:3px 9px; border-radius:100px; display:flex; align-items:center; gap:4px;">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                            PERSONAL
                        </span>
                        <button onclick="event.stopPropagation(); window.abrirContextMenu(event, '${a.id}')"
                            style="background:transparent; border:none; color:#94a3b8; cursor:pointer; padding:5px; border-radius:4px; display:flex; align-items:center;"
                            onmouseenter="this.style.background='#f1f5f9'; this.style.color='var(--ss-text-main)'"
                            onmouseleave="this.style.background='transparent'; this.style.color='#94a3b8'">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="1"></circle>
                                <circle cx="12" cy="5" r="1"></circle>
                                <circle cx="12" cy="19" r="1"></circle>
                            </svg>
                        </button>
                    </div>
                </div>`;
            }).join("");

        container.innerHTML = rows || `<div style="padding:3rem; text-align:center; color:#94a3b8;">No se encontraron análisis con ese nombre.</div>`;
        actualizarBreadcrumbAnalisis(_analisisActivo, _analisisNombres[_analisisActivo]);

    } catch (err) {
        container.innerHTML = `<div style="padding:2rem; text-align:center; color:#ef4444;">Error cargando lista: ${err.message}</div>`;
    }
};

window.filtrarAnalisis = function (val) {
    window.renderizarListaAnalisis();
};

// Abrir un análisis: activa su contexto (carga SOLO sus CSVs en Postgres)
window.abrirAnalisis = async function (analysisId) {
    if (_analisisActivo === analysisId) {
        document.querySelector('[data-tab="control-maestro"]')?.click();
        return;
    }

    const nombre = _analisisNombres[analysisId] || analysisId;
    Swal.fire({
        title: 'Cargando análisis...',
        html: `Activando <strong>${nombre}</strong>...`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_URL}/api/analyses/${encodeURIComponent(analysisId)}/activate`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            Swal.close();
            showToast(err.detail || 'Error al activar análisis', 'error');
            return;
        }
    } catch (e) {
        Swal.close();
        showToast('Error de conexión', 'error');
        return;
    }

    setAnalisisActivo(analysisId);
    _analisisNombres[analysisId] = nombre;
    guardarNombres();

    const sidebarGroup = document.getElementById('sidebar-analisis-group');
    const sidebarNombre = document.getElementById('sidebar-analisis-nombre');
    if (sidebarGroup) sidebarGroup.style.display = 'block';
    if (sidebarNombre) {
        sidebarNombre.textContent = nombre;
        sidebarNombre.title = `Análisis: ${nombre} — Clic para volver al inicio`;
    }

    window.renderizarListaAnalisis();
    Swal.close();
    document.querySelector('[data-tab="control-maestro"]')?.click();
    await inicializarTablero();
};


// ---- Renombrar análisis ----
window.iniciarRenombrar = function (filename) {
    const nameDiv = document.querySelector(`.analysis-name-display[data-filename="${filename}"]`);
    if (!nameDiv) return;
    const currentName = _analisisNombres[filename] || filename.replace(/\.csv$/i, "");

    nameDiv.innerHTML = `
        <input type="text" id="renameInput_${filename.replace(/\W/g, '_')}"
            value="${currentName}"
            style="width:100%; padding:2px 6px; border:1.5px solid var(--ss-blue); border-radius:4px; font-size:0.95rem; font-weight:600; color:var(--ss-text-main); outline:none;"
            onblur="window.confirmarRenombrar('${filename}', this.value)"
            onkeydown="if(event.key==='Enter'){this.blur();}if(event.key==='Escape'){window.renderizarListaAnalisis();}"
        >`;
    setTimeout(() => {
        const inp = document.getElementById(`renameInput_${filename.replace(/\W/g, '_')}`);
        if (inp) { inp.focus(); inp.select(); }
    }, 30);
};

window.confirmarRenombrar = async function (filename, newName) {
    const trimmed = newName.trim();
    if (trimmed) {
        try {
            const token = localStorage.getItem("token");
            const res = await fetch(`${API_URL}/api/analyses/${filename}/rename`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ nombre: trimmed })
            });
            if (!res.ok) throw new Error("Error al renombrar en el servidor");

            _analisisNombres[filename] = trimmed;
            guardarNombres();
            if (_analisisActivo === filename) {
                actualizarBreadcrumbAnalisis(filename, trimmed);
                // También actualizar en el sidebar si está activo
                const sidebarNombre = document.getElementById("sidebar-analisis-nombre");
                if (sidebarNombre) sidebarNombre.textContent = trimmed;
            }
            showToast(`Renombrado a "${trimmed}"`, "success");
        } catch (err) {
            showToast(`Error: ${err.message}`, "error");
        }
    }
    window.renderizarListaAnalisis();
};

// ---- Menú contextual de 3 puntos ----
window.abrirContextMenu = function (event, filename) {
    _contextMenuTarget = filename;
    const menu = document.getElementById("analysisContextMenu");
    if (!menu) return;

    // Position near button
    const rect = event.currentTarget.getBoundingClientRect();
    menu.style.display = "block";
    menu.style.top = (rect.bottom + 4) + "px";
    menu.style.left = (rect.right - 180) + "px";

    // Wire up buttons
    document.getElementById("ctxAbrir").onclick = () => {
        cerrarContextMenu();
        window.abrirAnalisis(filename);
    };
    document.getElementById("ctxRenombrar").onclick = () => {
        cerrarContextMenu();
        window.iniciarRenombrar(filename);
    };
    document.getElementById("ctxEliminar").onclick = async () => {
        cerrarContextMenu();
        await eliminarAnalisisHome(filename);
    };
};

function cerrarContextMenu() {
    const menu = document.getElementById("analysisContextMenu");
    if (menu) menu.style.display = "none";
    _contextMenuTarget = null;
}

// Close menu when clicking outside
document.addEventListener("click", (e) => {
    const menu = document.getElementById("analysisContextMenu");
    if (menu && !menu.contains(e.target)) cerrarContextMenu();
}, true);

// ---- Eliminar análisis ----
async function eliminarAnalisisHome(filename) {
    const displayName = _analisisNombres[filename] || filename;
    const confirm = await Swal.fire({
        title: "¿Eliminar análisis?",
        html: `Se eliminará el archivo <strong>"${displayName}"</strong> del servidor.<br><small style="color:#64748b;">Esta acción no se puede deshacer.</small>`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Eliminar",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#ef4444"
    });
    if (!confirm.isConfirmed) return;

    try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_URL}/api/analyses/${encodeURIComponent(filename)}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
            delete _analisisNombres[filename];
            if ((_analisisNombres.__ts__ || {})[filename]) delete _analisisNombres.__ts__[filename];
            guardarNombres();
            if (_analisisActivo === filename) {
                setAnalisisActivo(null);
            }
            showToast("Análisis eliminado correctamente", "success");
            await window.renderizarListaAnalisis();
        } else {
            const err = await res.json();
            showToast("Error: " + (err.detail || "No se pudo eliminar"), "error");
        }
    } catch (err) {
        showToast("Error de conexión", "error");
    }
}

// ---- Nuevo Análisis — flujo 2 pasos: Nombre → Subir CSVs ----
window.abrirModalNuevoAnalisis = function () {
    Swal.fire({
        title: "Nuevo Análisis",
        html: `
            <div style="text-align:left;">
                <label style="display:block; font-size:0.8rem; font-weight:700; color:#475569;
                              margin-bottom:8px; text-transform:uppercase; letter-spacing:0.06em;">Nombre del análisis</label>
                <input id="swalNombreAnalisis" type="text" placeholder="Ej: Inventario Sucursal Norte Q1"
                    style="width:100%; padding:10px 12px; border:1.5px solid #e2e8f0; border-radius:8px;
                           font-size:0.9rem; outline:none; color:#1e293b; box-sizing:border-box;"
                    onfocus="this.style.borderColor='#6366f1'"
                    onblur="this.style.borderColor='#e2e8f0'">
                <p style="font-size:0.78rem; color:#94a3b8; margin-top:8px; margin-bottom:0;">
                    Luego podrás agregar uno o más archivos CSV a este análisis.
                </p>
            </div>`,
        confirmButtonText: 'Crear análisis →',
        confirmButtonColor: '#6366f1',
        showCancelButton: true,
        cancelButtonText: 'Cancelar',
        didOpen: () => { setTimeout(() => document.getElementById('swalNombreAnalisis')?.focus(), 100); },
        preConfirm: async () => {
            const nombre = (document.getElementById('swalNombreAnalisis')?.value || '').trim();
            if (!nombre) { Swal.showValidationMessage('Ingresa un nombre para el análisis'); return false; }
            const token = localStorage.getItem("token");
            const res = await fetch(`${API_URL}/api/analyses`, {
                method: 'POST',
                headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ nombre })
            });
            if (!res.ok) { Swal.showValidationMessage('Error al crear. Intenta de nuevo.'); return false; }
            return await res.json();
        }
    }).then(result => {
        if (!result.isConfirmed || !result.value) return;
        const analisis = result.value;
        _analisisNombres[analisis.id] = analisis.nombre;
        guardarNombres();
        _abrirModalSubirCSVsAAnalisis(analisis);
    });
};

// Modal de subida de CSVs a un análisis (paso 2 o desde el Inspector)
window._abrirModalSubirCSVsAAnalisis = function (analisis) {
    let archivosSubidos = [];
    Swal.fire({
        title: analisis.nombre,
        html: `
            <div style="text-align:left;">
                <p style="color:#475569; font-size:0.82rem; margin-bottom:14px; line-height:1.5;">
                    Arrastra o selecciona <strong>archivos CSV</strong>. Puedes agregar múltiples fuentes.
                </p>
                <div id="dropZone2"
                     style="background:#faf5ff; border:2px dashed #c4b5fd; border-radius:10px;
                            padding:1.5rem; text-align:center; cursor:pointer; transition:all 0.2s;"
                     ondragover="event.preventDefault(); this.style.borderColor='#7c3aed'; this.style.background='#f3e8ff';"
                     ondragleave="this.style.borderColor='#c4b5fd'; this.style.background='#faf5ff';"
                     ondrop="event.preventDefault(); this.style.borderColor='#c4b5fd'; this.style.background='#faf5ff'; window._dz2HandleDrop(event);">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.5"
                         stroke-linecap="round" stroke-linejoin="round" style="display:block; margin:0 auto 10px;">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="17 8 12 3 7 8"></polyline>
                        <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                    <div style="font-size:0.85rem; color:#6b7280; font-weight:500;">
                        Arrastra CSVs aquí o <span style="color:#7c3aed; font-weight:700; text-decoration:underline;">haz clic</span>
                    </div>
                    <div style="font-size:0.7rem; color:#a78bfa; margin-top:4px;">Múltiples archivos · Hasta 50 MB cada uno</div>
                    <input type="file" id="dz2Input" accept=".csv" multiple style="display:none;"
                           onchange="window._dz2HandleFiles(this.files)">
                </div>
                <div id="dz2FileList" style="margin-top:12px; max-height:160px; overflow-y:auto;"></div>
            </div>`,
        showConfirmButton: true,
        confirmButtonText: 'Abrir análisis →',
        confirmButtonColor: '#6366f1',
        showCancelButton: true,
        cancelButtonText: 'Terminar después',
        width: 520,
        didOpen: () => {
            document.getElementById('dropZone2').onclick = (e) => {
                if (e.target.tagName !== 'INPUT') document.getElementById('dz2Input')?.click();
            };
            window._dz2HandleDrop = (evt) => {
                const files = Array.from(evt.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.csv'));
                if (files.length) window._dz2HandleFiles(files);
            };
            window._dz2HandleFiles = async (fileOrList) => {
                const files = fileOrList instanceof FileList ? Array.from(fileOrList) :
                    Array.isArray(fileOrList) ? fileOrList : [fileOrList];
                for (const file of files) {
                    if (!file.name.toLowerCase().endsWith('.csv')) continue;
                    await _subirArchivoAAnalisis(analisis.id, file, archivosSubidos);
                }
            };
        }
    }).then(async () => {
        if (archivosSubidos.length === 0) { await window.renderizarListaAnalisis(); return; }
        setAnalisisActivo(analisis.id);
        _analisisNombres[analisis.id] = analisis.nombre;
        guardarNombres();
        const sg = document.getElementById('sidebar-analisis-group');
        const sn = document.getElementById('sidebar-analisis-nombre');
        if (sg) sg.style.display = 'block';
        if (sn) sn.textContent = analisis.nombre;
        await window.renderizarListaAnalisis();
        if (window.cargarListaArchivos) await window.cargarListaArchivos();
        await inicializarTablero();
        document.querySelector('[data-tab="control-maestro"]')?.click();
    });
};

async function _subirArchivoAAnalisis(analysisId, file, archivosSubidos) {
    const listEl = document.getElementById('dz2FileList');
    const rowId = `dz2row_${file.name.replace(/\W/g, '_')}`;
    if (listEl) {
        const row = document.createElement('div');
        row.id = rowId;
        row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:8px 10px; background:#f8fafc; border-radius:7px; margin-bottom:6px; font-size:0.82rem;';
        row.innerHTML = `
            <div style="width:20px; height:20px; border:2px solid #6366f1; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; flex-shrink:0;"></div>
            <span style="flex:1; color:#1e293b; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${file.name.replace(/\.csv$/i, '')}</span>
            <span style="color:#94a3b8; font-size:0.7rem;">Subiendo...</span>`;
        listEl.appendChild(row);
    }
    try {
        const token = localStorage.getItem("token");
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`${API_URL}/api/analyses/${encodeURIComponent(analysisId)}/files`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` },
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Error al subir");
        archivosSubidos.push(file.name);
        const row = document.getElementById(rowId);
        if (row) row.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span style="flex:1; color:#1e293b; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${file.name.replace(/\.csv$/i, '')}</span>
            <span style="color:#16a34a; font-size:0.7rem; font-weight:600;">✓ Listo</span>`;
    } catch (err) {
        const row = document.getElementById(rowId);
        if (row) row.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            <span style="flex:1; color:#dc2626; font-size:0.8rem;">${err.message}</span>`;
    }
}

// Inspector: al estar dentro de un análisis, permite agregar más CSVs al mismo
window.inspectorUploadClick = function () {
    if (_analisisActivo) {
        const nombre = _analisisNombres[_analisisActivo] || _analisisActivo;
        _abrirModalSubirCSVsAAnalisis({ id: _analisisActivo, nombre });
    } else {
        document.getElementById('fileInput')?.click();
    }
};


// Cargar lista al iniciar el Home tab
(function initHome() {
    // Immediate check if element exists (since script is at end of body)
    if (document.getElementById("homeAnalysisList")) {
        console.debug("Home list container found, rendering...");
        setTimeout(() => {
            if (window.renderizarListaAnalisis) window.renderizarListaAnalisis();
        }, 300);
    } else {
        // Fallback: MutationObserver if DOM is not yet ready
        const observer = new MutationObserver(() => {
            if (document.getElementById("homeAnalysisList")) {
                observer.disconnect();
                setTimeout(() => {
                    if (window.renderizarListaAnalisis) window.renderizarListaAnalisis();
                }, 300);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Also hook into tab switching
    document.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-tab]");
        if (btn && btn.dataset.tab === "home") {
            setTimeout(window.renderizarListaAnalisis, 100);
        }
    });

    // Restore active analysis from storage on load
    if (_analisisActivo) actualizarBreadcrumbAnalisis(_analisisActivo, _analisisNombres[_analisisActivo] || _analisisActivo);
})();
