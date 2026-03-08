# Smart Stock Solution

Sistema inteligente de gestión de inventario con predicción de demanda mediante IA.

## Estructura del Proyecto

- `backend/`: API construida con FastAPI y procesamiento de datos con Polars.
- `frontend/`: Interfaz de usuario premium construida con HTML y JavaScript vanilla.

## Requisitos

- Python 3.10+
- PostgreSQL

## Instalación

1. Clonar el repositorio.
2. Crear un entorno virtual: `python -m venv .venv`
3. Activar el entorno virtual e instalar dependencias: `pip install -r requirements.txt`
4. Configurar las variables de entorno:
   - Copiar `.env.example` a `.env`
   - Completar las credenciales en `.env`
5. Iniciar el servidor: `uvicorn backend.main:app --reload`
6. Abrir `frontend/index.html` en el navegador.

## Características

- Dashboard con métricas clave.
- Mapa interactivo de sucursales.
- Recomendaciones estratégicas impulsadas por IA.
- Análisis de sensibilidad de precios.
- Gestión de productos próximos a vencer.
