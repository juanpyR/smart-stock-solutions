/**
 * relationships.js
 * Handles D3.js visualization for Data Relationships
 */

async function cargarRelaciones() {
    const container = document.getElementById('relationsGraph');
    if (!container) return;

    // Clear previous graph
    container.innerHTML = '';
    const width = container.clientWidth;
    const height = container.clientHeight || 500;

    try {
        const res = await fetch(`${API_URL}/api/data/relationships`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await res.json();

        if (!data.nodes || data.nodes.length === 0) {
            container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;">No hay suficientes archivos para detectar relaciones</div>';
            return;
        }

        const svg = d3.select('#relationsGraph')
            .append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', [0, 0, width, height]);

        const simulation = d3.forceSimulation(data.nodes)
            .force('link', d3.forceLink(data.links).id(d => d.id).distance(150))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(width / 2, height / 2));

        // Links
        const link = svg.append('g')
            .selectAll('line')
            .data(data.links)
            .join('line')
            .attr('stroke', '#cbd5e1')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', d => Math.sqrt(d.columns.length) * 2);

        // Nodes
        const node = svg.append('g')
            .selectAll('g')
            .data(data.nodes)
            .join('g')
            .call(drag(simulation));

        node.append('circle')
            .attr('r', 12)
            .attr('fill', '#4f46e5')
            .attr('stroke', '#fff')
            .attr('stroke-width', 2);

        node.append('text')
            .attr('x', 16)
            .attr('y', 4)
            .attr('font-size', '10px')
            .attr('font-weight', '600')
            .attr('fill', '#334155')
            .text(d => d.name);

        // Tooltip interaction
        const tooltip = document.getElementById('relationsTooltip');

        node.on('mouseover', (event, d) => {
            tooltip.style.display = 'block';
            tooltip.innerHTML = `<strong>${d.name}</strong><br>${d.columns.length} columnas<br>${(d.size / 1024).toFixed(1)} KB`;
        })
            .on('mousemove', (event) => {
                tooltip.style.left = (event.pageX + 10) + 'px';
                tooltip.style.top = (event.pageY + 10) + 'px';
            })
            .on('mouseout', () => {
                tooltip.style.display = 'none';
            });

        link.on('mouseover', (event, d) => {
            tooltip.style.display = 'block';
            tooltip.innerHTML = `<strong>Relación: ${d.source.name} ↔ ${d.target.name}</strong><br>Llaves comunes: ${d.columns.join(', ')}`;
        })
            .on('mouseout', () => {
                tooltip.style.display = 'none';
            });

        simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            node
                .attr('transform', d => `translate(${d.x},${d.y})`);
        });

        function drag(simulation) {
            function dragstarted(event) {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                event.subject.fx = event.subject.x;
                event.subject.fy = event.subject.y;
            }
            function dragged(event) {
                event.subject.fx = event.x;
                event.subject.fy = event.y;
            }
            function dragended(event) {
                if (!event.active) simulation.alphaTarget(0);
                event.subject.fx = null;
                event.subject.fy = null;
            }
            return d3.drag()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended);
        }

    } catch (err) {
        console.error('Error cargando relaciones:', err);
    }
}

function switchInspectorView(view) {
    const schema = document.getElementById('inspectorContent');
    const relations = document.getElementById('relationsContent');
    const tabSchema = document.getElementById('tabSchema');
    const tabRelations = document.getElementById('tabRelations');

    if (view === 'schema') {
        schema.style.display = 'block';
        relations.style.display = 'none';
        tabSchema.classList.add('active');
        tabRelations.classList.remove('active');
    } else {
        schema.style.display = 'none';
        relations.style.display = 'block';
        tabSchema.classList.remove('active');
        tabRelations.classList.add('active');
        cargarRelaciones();
    }
}
